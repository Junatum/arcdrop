// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser signaling module.
import { state, LIMIT, sizeText, wakePoll } from './core.js';
import { $, notice, show } from './ui.js';
import { signal } from './api.js';
import { renderPeers } from './discovery.js';
import { clearIncoming, cancelTransfer, armTimeout, installChannel } from './transfer.js';

export const rtcConfig = { iceServers: [] }; // No external STUN/TURN; LAN P2P only.

export const ICE_GATHER_TIMEOUT_MS = 10000;

export const INVITE_RESPONSE_TIMEOUT_MS = 30000;
// Poll frequently during a transfer, but reduce idle/background CGI traffic.
// The server expires sessions after 45 seconds, including when backgrounded.

export function createConnection(t) {
  const pc = new RTCPeerConnection(rtcConfig);
  t.pc = pc;
  // Gather local LAN candidates into the SDP before signaling. Safari/WebKit
  // and Firefox can otherwise observe candidate/SDP events in a different
  // order when each trickled candidate uses a separate CGI request.
  pc.onconnectionstatechange = () => {
    if (state.active !== t) return;
    if (!t.finished && pc.connectionState === 'failed')
      void cancelTransfer('기기 간 ICE 연결에 실패했습니다. 동일한 LAN과 무선 격리 설정을 확인해주세요.', false);
    else if (!t.finished && pc.connectionState === 'closed')
      void cancelTransfer('기기 간 직접 연결이 종료되었습니다.', false);
  };
  if (t.role === 'receiver') pc.ondatachannel = (event) => installChannel(t, event.channel);
  return pc;
}

export function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeout;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      pc.removeEventListener('icegatheringstatechange', onChange);
      pc.removeEventListener('signalingstatechange', onChange);
      if (error) reject(error);
      else resolve();
    }
    function onChange() {
      if (pc.iceGatheringState === 'complete') finish();
      else if (pc.signalingState === 'closed') finish(new Error('ICE 후보 수집이 중단되었습니다.'));
    }
    pc.addEventListener('icegatheringstatechange', onChange);
    pc.addEventListener('signalingstatechange', onChange);
    timeout = setTimeout(() => finish(new Error('ICE 후보 수집 시간이 초과되었습니다. 브라우저 네트워크 설정을 확인해주세요.')), ICE_GATHER_TIMEOUT_MS);
    onChange();
  });
}

export async function localSdpWithCandidates(pc) {
  await waitForIceGathering(pc);
  const sdp = pc.localDescription?.toJSON();
  if (!sdp || !/a=candidate:/i.test(sdp.sdp))
    throw new Error('LAN 연결을 위한 ICE 후보가 생성되지 않았습니다. 브라우저의 네트워크 접근 권한을 확인해주세요.');
  return sdp;
}

export async function addRemoteCandidate(t, candidate) {
  if (state.active !== t || !t.pc || t.pc.signalingState === 'closed') return;
  try { await t.pc.addIceCandidate(candidate); }
  catch (err) {
    // Older ArcDrop versions still trickle ICE candidates. A single
    // browser-specific/mDNS candidate failure must not discard the other
    // candidates delivered by the same poll response.
    console.warn('ArcDrop: remote ICE candidate was rejected', err?.name || 'unknown');
  }
}

export async function addPendingCandidates(t) {
  if (!t.pc?.remoteDescription) return;
  for (const candidate of t.candidates.splice(0)) await addRemoteCandidate(t, candidate);
}

export async function makeOffer(t) {
  const pc = createConnection(t);
  const channel = pc.createDataChannel('arcdrop-file', { ordered: true });
  installChannel(t, channel);
  await pc.setLocalDescription(await pc.createOffer());
  const sdp = await localSdpWithCandidates(pc);
  if (state.active === t) await signal(t.peerId, 'offer', { sdp });
}

export async function handleSignal(message) {
  const { from, kind, body } = message;
  const t = state.active;
  if (kind === 'invite') {
    if (t || state.incoming || !Number.isSafeInteger(body?.size) || body.size < 0 || body.size > LIMIT ||
        typeof body?.name !== 'string' || body.name.length > 255) {
      await signal(from, 'decline'); return;
    }
    const sender = state.peers.find((x) => x.id === from)?.name || '다른 기기';
    const incoming = { from, sender, body, timeout: null };
    state.incoming = incoming;
    incoming.timeout = setTimeout(() => {
      if (state.incoming !== incoming) return;
      clearIncoming();
      renderPeers();
      notice('파일 수신 요청이 만료되었습니다. 다시 요청해주세요.');
      void signal(from, 'decline').catch(() => {});
    }, INVITE_RESPONSE_TIMEOUT_MS);
    wakePoll();
    $('incoming-title').textContent = `${sender}에서 파일을 보내려고 합니다.`;
    $('incoming-detail').textContent = `${body.name} · ${sizeText(body.size)}`;
    show('incoming', true); renderPeers();
    return;
  }
  if (kind === 'decline' && t?.peerId === from) { await cancelTransfer('상대방이 파일 전송을 거절했습니다.', false); return; }
  if (kind === 'bye' && t?.peerId === from) { await cancelTransfer('상대방이 전송을 종료했습니다.', false); return; }
  if (!t || t.peerId !== from) return;
  if (kind === 'accept' && t.role === 'sender' && t.phase === 'awaiting-approval' && !t.pc) {
    t.phase = 'negotiating'; armTimeout(t); await makeOffer(t); return;
  }
  if (kind === 'offer' && t.role === 'receiver' && t.phase === 'awaiting-offer' &&
      !t.pc && body?.sdp?.type === 'offer') {
    t.phase = 'negotiating';
    const pc = createConnection(t);
    await pc.setRemoteDescription(body.sdp);
    await addPendingCandidates(t);
    await pc.setLocalDescription(await pc.createAnswer());
    const sdp = await localSdpWithCandidates(pc);
    if (state.active === t) await signal(t.peerId, 'answer', { sdp });
    return;
  }
  if (kind === 'answer' && t.role === 'sender' && t.phase === 'negotiating' &&
      t.pc && !t.pc.remoteDescription && body?.sdp?.type === 'answer') {
    await t.pc.setRemoteDescription(body.sdp);
    await addPendingCandidates(t); return;
  }
  if (kind === 'candidate' && body?.candidate) {
    if (t.pc?.remoteDescription) await addRemoteCandidate(t, body.candidate);
    else if (t.candidates.length < 40) t.candidates.push(body.candidate);
  }
}
