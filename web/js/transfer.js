// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser transfer module.
import { state, LIMIT, CHUNK, sleep, sizeText, wakePoll } from './core.js';
import { $, show, notice, progress } from './ui.js';
import { signal, newSignalId } from './api.js';
import { renderPeers } from './discovery.js';

export const UI_UPDATE_INTERVAL_MS = 100;
export const RECEIVE_SEGMENT_BYTES = 1024 * 1024;
// WebCrypto digest() requires a contiguous buffer. Keep its optional extra
// allocation below 8 MiB to avoid memory spikes on iOS / older devices.
export const INTEGRITY_MAX_BYTES = 8 * 1024 * 1024;

async function smallFileDigest(file) {
  if (file.size > INTEGRITY_MAX_BYTES || !globalThis.crypto?.subtle?.digest) return null;
  const result = await globalThis.crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(result), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function transferProgress(t, title, current, total, details, force = false) {
  const now = Date.now();
  if (!force && t.lastUiAt !== undefined && now - t.lastUiAt < UI_UPDATE_INTERVAL_MS) return;
  t.lastUiAt = now;
  progress(title, current, total, details);
}

function flushReceiveSegment(t) {
  if (!t.received?.length) return;
  if (!t.parts) t.parts = [];
  t.parts.push(new Blob(t.received, { type: 'application/octet-stream' }));
  t.received = [];
  t.segmentBytes = 0;
}

export function clearIncoming() {
  const request = state.incoming;
  if (request?.timeout) clearTimeout(request.timeout);
  state.incoming = null;
  show('incoming', false);
  wakePoll();
  return request;
}

export function cleanDownload() {
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = null;
  show('download', false);
}

export function resetTransfer() {
  const t = state.active;
  if (t) {
    if (t.timeout) clearTimeout(t.timeout);
    t.received = [];
    t.parts = [];
    if (t.channel && t.channel.readyState !== 'closed') t.channel.close();
    if (t.pc) t.pc.close();
  }
  state.active = null;
  clearIncoming();
  wakePoll();
  show('transfer', false);
  renderPeers();
}

export async function cancelTransfer(reason = '전송이 취소되었습니다.', notify = true) {
  const peer = state.active?.peerId || state.incoming?.from;
  const transferId = state.active?.transferId || state.incoming?.transferId || null;
  resetTransfer();
  notice(reason, true);
  if (notify && peer && state.session) {
    try { await signal(peer, 'bye', {}, transferId); } catch { /* peer already disconnected */ }
  }
}
// The server's directory iteration order is unstable. Preserve known order,
// allocate fixed visual slots, and reuse existing DOM nodes during polling.

export function armTimeout(active) {
  active.deadline = Date.now() + 30000;
  if (active.timeout) return;
  const check = () => {
    active.timeout = null;
    if (state.active !== active || active.finished) return;
    if (Date.now() >= active.deadline) {
      void cancelTransfer('연결 시간이 초과되었습니다.');
      return;
    }
    active.timeout = setTimeout(check, Math.max(1, active.deadline - Date.now()));
  };
  active.timeout = setTimeout(check, 30000);
}

export async function beginInvite(peer, file) {
  if (state.active || state.incoming) return;
  if (!file) return;
  if (file.size > LIMIT) { notice('파일은 최대 64 MiB까지 전송할 수 있습니다.', true); return; }
  cleanDownload();
  const active = { peerId: peer.id, peerName: peer.name, role: 'sender', file, pc: null, channel: null, candidates: [], received: [], parts: [], segmentBytes: 0, bytes: 0, timeout: null, phase: 'awaiting-approval', transferId: peer.protocolVersion === 2 ? newSignalId() : null };
  state.active = active;
  wakePoll();
  armTimeout(active); renderPeers();
  progress('승인 대기 중', 0, file.size, `${peer.name}에서 수신 승인을 기다립니다.`);
  try { await signal(peer.id, 'invite', { name: file.name, size: file.size }, active.transferId); }
  catch (err) { if (state.active === active) await cancelTransfer(err.message, false); }
}

export async function acceptIncoming() {
  const request = state.incoming;
  if (!request || state.active) return;
  clearIncoming();
  const t = { peerId: request.from, peerName: request.sender, role: 'receiver',
    offer: request.body, pc: null, channel: null, candidates: [], received: [], parts: [], segmentBytes: 0, bytes: 0, timeout: null, phase: 'awaiting-offer', transferId: request.transferId || null };
  state.active = t;
  wakePoll();
  armTimeout(t); renderPeers();
  progress('수신 준비 중', 0, t.offer.size, `${t.peerName}와 직접 연결합니다.`);
  try { await signal(t.peerId, 'accept', {}, t.transferId); }
  catch (err) { await cancelTransfer(err.message, false); }
}

export async function declineIncoming() {
  const request = clearIncoming();
  renderPeers();
  if (request) try { await signal(request.from, 'decline', {}, request.transferId); } catch { /* disconnected */ }
}

export function installChannel(t, channel) {
  t.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onopen = () => {
    if (state.active !== t) return;
    armTimeout(t);
    if (t.role === 'sender') void sendFile(t).catch((err) => {
      if (state.active === t) void cancelTransfer(err.message);
    });
    else { t.phase = 'receiving'; progress('수신 중', 0, t.offer.size, `${t.peerName}에서 파일을 받습니다.`); }
  };
  channel.onmessage = (ev) => {
    if (state.active !== t) return;
    try { receiveMessage(t, ev.data); }
    catch (err) { void cancelTransfer(err.message); }
  };
  channel.onerror = () => {
    if (state.active === t && !t.finished)
      void cancelTransfer('전송 채널에 오류가 발생했습니다.');
  };
}

export async function sendFile(t) {
  const channel = t.channel;
  if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
  t.phase = 'sending';
  const sha256 = await smallFileDigest(t.file);
  if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
  channel.send(JSON.stringify({ type: 'meta', name: t.file.name, size: t.file.size }));
  for (let offset = 0; offset < t.file.size; offset += CHUNK) {
    if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
    while (channel.bufferedAmount > 1024 * 1024) {
      if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
      await sleep(30);
    }
    const bytes = await t.file.slice(offset, Math.min(t.file.size, offset + CHUNK)).arrayBuffer();
    channel.send(bytes);
    t.bytes = Math.min(t.file.size, offset + bytes.byteLength);
    armTimeout(t);
    transferProgress(t, '파일 전송 중', t.bytes, t.file.size, `${t.peerName}에 직접 전송 중`);
  }
  if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
  t.phase = 'awaiting-ack';
  channel.send(JSON.stringify(sha256 ? { type: 'end', sha256 } : { type: 'end' }));
  transferProgress(t, '저장 확인 대기', t.file.size, t.file.size, '수신 기기에서 전송 완료를 확인합니다.', true);
  armTimeout(t);
}

async function verifyAndComplete(t, blob, expected) {
  const result = await globalThis.crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  const digest = Array.from(new Uint8Array(result), (x) => x.toString(16).padStart(2, '0')).join('');
  if (digest !== expected) throw Error('파일 무결성 검사에 실패했습니다.');
  if (state.active !== t) return;
  completeReceive(t, blob);
}

function completeReceive(t, blob) {
  if (state.active !== t) return;
  t.phase = 'complete';
  cleanDownload(); state.blobUrl = URL.createObjectURL(blob);
  $('download-link').href = state.blobUrl;
  $('download-link').download = t.offer.name;
  $('download-title').textContent = `${t.offer.name} · ${sizeText(t.bytes)}`;
  show('transfer', false);
  show('download', true);
  $('done').focus();
  t.finished = true;
  // The file is already verified. A peer that closes during the ACK
  // handshake must not turn successful reception into a false error.
  try { t.channel.send(JSON.stringify({ type: 'ack' })); }
  catch { /* remote peer disconnected after the payload arrived */ }
  notice('수신이 완료되었습니다. 파일 저장 버튼을 눌러주세요.');
  setTimeout(() => { if (state.active === t) resetTransfer(); }, 800);
}

export function receiveMessage(t, data) {
  if (typeof data === 'string') {
    const msg = JSON.parse(data);
    if (msg.type === 'meta' && t.role === 'receiver' && t.phase === 'receiving' && !t.started) {
      if (msg.name !== t.offer.name || msg.size !== t.offer.size) throw Error('요청 정보와 전송 파일이 다릅니다.');
      t.started = true; return;
    }
    if (msg.type === 'end' && t.role === 'receiver' && t.phase === 'receiving' &&
        t.started && t.bytes === t.offer.size) {
      const sha = msg.sha256;
      if (sha !== undefined && (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)))
        throw Error('잘못된 파일 검증 정보입니다.');
      flushReceiveSegment(t);
      const blob = new Blob(t.parts, { type: 'application/octet-stream' });
      t.parts = [];
      t.phase = 'verifying';
      // Only announce success after verifying the optional small-file SHA-256.
      if (sha) {
        if (!globalThis.crypto?.subtle?.digest || blob.size > INTEGRITY_MAX_BYTES)
          throw Error('파일 무결성 확인을 수행할 수 없습니다.');
        armTimeout(t);
        void verifyAndComplete(t, blob, sha).catch((err) => {
          if (state.active === t) void cancelTransfer(err.message);
        });
      } else completeReceive(t, blob);
      return;
    }
    if (msg.type === 'ack' && t.role === 'sender' && t.phase === 'awaiting-ack' &&
        t.bytes === t.file.size) {
      t.phase = 'complete';
      t.finished = true; notice('파일 전송이 완료되었습니다.'); resetTransfer(); return;
    }
    throw Error('예상하지 못한 전송 메시지입니다.');
  }
  if (t.role !== 'receiver' || t.phase !== 'receiving' || !t.started || t.finished ||
      !(data instanceof ArrayBuffer) || data.byteLength === 0 || data.byteLength > CHUNK ||
      t.bytes + data.byteLength > t.offer.size) throw Error('잘못된 파일 데이터가 도착했습니다.');
  t.received.push(data); t.bytes += data.byteLength;
  t.segmentBytes = (t.segmentBytes || 0) + data.byteLength;
  if (t.segmentBytes >= RECEIVE_SEGMENT_BYTES) flushReceiveSegment(t);
  armTimeout(t);
  transferProgress(t, '파일 수신 중', t.bytes, t.offer.size, `${t.peerName}에서 직접 전송 중`);
}
