/* ArcDrop WebRTC client - original implementation, GPL-3.0-or-later. */
'use strict';
const LIMIT = 64 * 1024 * 1024;
const CHUNK = 16 * 1024;
const API = '/cgi-bin/arcdrop';
const rtcConfig = { iceServers: [] }; // No external STUN/TURN; LAN P2P only.
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizeText = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`;
const state = { session: null, peers: [], active: null, incoming: null, selectedPeer: null, blobUrl: null, running: true };
let toastTimer = null;

function setConnectionStatus(status, label) {
  $('connection-status').dataset.status = status;
  $('connection-label').textContent = label;
  $('discovery').dataset.status = status;
}
function show(id, visible) {
  $(id).classList.toggle('hidden', !visible);
  document.body.classList.toggle('modal-open', !!document.querySelector('.dialog-backdrop:not(.hidden)'));
}
function notice(message, error = false) {
  $('notice-text').textContent = message;
  $('notice').classList.toggle('error', error);
  show('notice', error);
  if (toastTimer) clearTimeout(toastTimer);
  show('toast', false);
  if (!error && message) {
    $('toast').textContent = message;
    show('toast', true);
    toastTimer = setTimeout(() => show('toast', false), 4500);
  }
}
function progress(title, current, total, details) {
  $('transfer-title').textContent = title;
  const percentage = total > 0 ? Math.min(100, Math.round(current * 100 / total)) : 100;
  $('transfer-percent').textContent = `${percentage}%`;
  $('progress-fill').style.width = `${percentage}%`;
  $('transfer-progress').setAttribute('aria-valuenow', String(percentage));
  $('transfer-detail').textContent = details;
  show('transfer', true);
}
function deviceIcon(name) {
  if (/iphone|android|phone|pixel|galaxy/i.test(name)) return 'phone';
  if (/ipad|tablet|tab\b/i.test(name)) return 'tablet';
  if (/macbook|laptop|notebook/i.test(name)) return 'laptop';
  return 'desktop';
}
function peerPosition(index, count) {
  const angles = {
    1: [-90], 2: [-135, -45], 3: [-150, -30, 90],
    4: [-145, -35, 35, 145], 5: [-150, -90, -30, 45, 135],
    6: [-150, -90, -30, 30, 90, 150],
  };
  const angle = angles[count]?.[index] ?? -90;
  const radians = angle * Math.PI / 180;
  const radius = Math.sin(radians) > 0 ? 190 : 235;
  return { x: Math.round(Math.cos(radians) * radius), y: Math.round(Math.sin(radians) * radius) };
}
function choosePeerFile(peer) {
  if (state.active || state.incoming) return;
  state.selectedPeer = peer;
  $('file-input').value = '';
  $('file-input').click();
}
function handlePeerDrop(event, peer) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (state.active || state.incoming) return;
  if (!event.dataTransfer?.files || event.dataTransfer.files.length !== 1) {
    notice('전송할 파일을 하나만 선택해주세요.', true); return;
  }
  void beginInvite(peer, event.dataTransfer.files[0]);
}
function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('arcdrop-theme') === 'light' ? 'light' : 'dark'; }
  catch { /* blocked storage: use dark theme */ }
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('arcdrop-theme', next); } catch { /* blocked storage */ }
  });
}
async function api(action, extra = {}) {
  const data = state.session ? { id: state.session.id, token: state.session.token, ...extra } : extra;
  const response = await fetch(`${API}?action=${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data), cache: 'no-store', credentials: 'same-origin',
  });
  let payload;
  try { payload = await response.json(); } catch { throw new Error('서버 응답을 읽지 못했습니다.'); }
  if (!response.ok) throw new Error(payload.error || `연결 오류 (${response.status})`);
  return payload;
}
async function signal(to, kind, body = {}) { return api('signal', { to, kind, body }); }
function cleanDownload() {
  if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
  state.blobUrl = null;
  show('download', false);
}
function resetTransfer() {
  const t = state.active;
  if (t) {
    if (t.timeout) clearTimeout(t.timeout);
    if (t.channel && t.channel.readyState !== 'closed') t.channel.close();
    if (t.pc) t.pc.close();
  }
  state.active = null;
  state.incoming = null;
  show('incoming', false);
  show('transfer', false);
  renderPeers();
}
async function cancelTransfer(reason = '전송이 취소되었습니다.', notify = true) {
  const peer = state.active?.peerId || state.incoming?.from;
  resetTransfer();
  notice(reason, true);
  if (notify && peer && state.session) {
    try { await signal(peer, 'bye', {}); } catch { /* peer already disconnected */ }
  }
}
function renderPeers() {
  const root = $('devices');
  root.replaceChildren();
  const count = state.peers.length;
  $('peer-count').textContent = count ? `주변 기기 ${count}대` : '주변 기기를 찾는 중';
  $('discovery').dataset.density = count > 6 ? 'many' : 'radial';
  $('discovery').dataset.empty = count ? 'false' : 'true';
  $('discovery').style.setProperty('--list-height', `${Math.ceil(count / 2) * 140}px`);
  for (const [index, peer] of state.peers.entries()) {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'peer';
    btn.disabled = !!(state.active || state.incoming);
    btn.setAttribute('aria-label', `${peer.name}에 파일 보내기`);
    const pos = peerPosition(index, count);
    btn.style.setProperty('--peer-x', `${pos.x}px`);
    btn.style.setProperty('--peer-y', `${pos.y}px`);
    const orb = document.createElement('span'); orb.className = 'peer-orb';
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon'); icon.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${deviceIcon(peer.name)}`);
    icon.append(use); orb.append(icon);
    const title = document.createElement('span'); title.className = 'peer-name'; title.textContent = peer.name;
    const subtitle = document.createElement('span'); subtitle.className = 'peer-action'; subtitle.textContent = '파일 보내기';
    btn.append(orb, title, subtitle);
    btn.addEventListener('click', () => choosePeerFile(peer));
    btn.addEventListener('dragover', (event) => {
      if (btn.disabled || !event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; btn.classList.add('drag-over');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
    btn.addEventListener('drop', (event) => handlePeerDrop(event, peer));
    root.append(btn);
  }
}
function armTimeout(active) {
  if (active.timeout) clearTimeout(active.timeout);
  active.timeout = setTimeout(() => {
    if (state.active === active) void cancelTransfer('연결 시간이 초과되었습니다.');
  }, 30000);
}
async function beginInvite(peer, file) {
  if (state.active || state.incoming) return;
  if (!file) return;
  if (file.size > LIMIT) { notice('파일은 최대 64 MiB까지 전송할 수 있습니다.', true); return; }
  cleanDownload();
  const active = { peerId: peer.id, peerName: peer.name, role: 'sender', file, pc: null, channel: null, candidates: [], received: [], bytes: 0, timeout: null };
  state.active = active;
  armTimeout(active); renderPeers();
  progress('승인 대기 중', 0, file.size, `${peer.name}에서 수신 승인을 기다립니다.`);
  try { await signal(peer.id, 'invite', { name: file.name, size: file.size }); }
  catch (err) { if (state.active === active) await cancelTransfer(err.message, false); }
}
async function acceptIncoming() {
  const request = state.incoming;
  if (!request || state.active) return;
  state.incoming = null; show('incoming', false);
  const t = { peerId: request.from, peerName: request.sender, role: 'receiver',
    offer: request.body, pc: null, channel: null, candidates: [], received: [], bytes: 0, timeout: null };
  state.active = t;
  armTimeout(t); renderPeers();
  progress('수신 준비 중', 0, t.offer.size, `${t.peerName}와 직접 연결합니다.`);
  try { await signal(t.peerId, 'accept'); }
  catch (err) { await cancelTransfer(err.message, false); }
}
async function declineIncoming() {
  const request = state.incoming;
  state.incoming = null; show('incoming', false); renderPeers();
  if (request) try { await signal(request.from, 'decline'); } catch { /* disconnected */ }
}
function createConnection(t) {
  const pc = new RTCPeerConnection(rtcConfig);
  t.pc = pc;
  pc.onicecandidate = (event) => {
    if (event.candidate && state.active === t)
      void signal(t.peerId, 'candidate', { candidate: event.candidate.toJSON() })
        .catch((err) => { if (state.active === t) void cancelTransfer(err.message); });
  };
  pc.onconnectionstatechange = () => {
    if (state.active !== t) return;
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed')
      void cancelTransfer('기기 간 직접 연결이 종료되었습니다.', false);
  };
  if (t.role === 'receiver') pc.ondatachannel = (event) => installChannel(t, event.channel);
  return pc;
}
async function addPendingCandidates(t) {
  if (!t.pc?.remoteDescription) return;
  for (const candidate of t.candidates.splice(0)) await t.pc.addIceCandidate(candidate);
}
async function makeOffer(t) {
  const pc = createConnection(t);
  const channel = pc.createDataChannel('arcdrop-file', { ordered: true });
  installChannel(t, channel);
  await pc.setLocalDescription(await pc.createOffer());
  await signal(t.peerId, 'offer', { sdp: pc.localDescription.toJSON() });
}
async function handleSignal(message) {
  const { from, kind, body } = message;
  const t = state.active;
  if (kind === 'invite') {
    if (t || state.incoming || !Number.isSafeInteger(body?.size) || body.size < 0 || body.size > LIMIT ||
        typeof body?.name !== 'string' || body.name.length > 255) {
      await signal(from, 'decline'); return;
    }
    const sender = state.peers.find((x) => x.id === from)?.name || '다른 기기';
    state.incoming = { from, sender, body };
    $('incoming-title').textContent = `${sender}에서 파일을 보내려고 합니다.`;
    $('incoming-detail').textContent = `${body.name} · ${sizeText(body.size)}`;
    show('incoming', true); renderPeers();
    return;
  }
  if (kind === 'decline' && t?.peerId === from) { await cancelTransfer('상대방이 파일 전송을 거절했습니다.', false); return; }
  if (kind === 'bye' && t?.peerId === from) { await cancelTransfer('상대방이 전송을 종료했습니다.', false); return; }
  if (!t || t.peerId !== from) return;
  if (kind === 'accept' && t.role === 'sender' && !t.pc) { armTimeout(t); await makeOffer(t); return; }
  if (kind === 'offer' && t.role === 'receiver' && !t.pc && body?.sdp?.type === 'offer') {
    const pc = createConnection(t);
    await pc.setRemoteDescription(body.sdp);
    await addPendingCandidates(t);
    await pc.setLocalDescription(await pc.createAnswer());
    await signal(t.peerId, 'answer', { sdp: pc.localDescription.toJSON() }); return;
  }
  if (kind === 'answer' && t.role === 'sender' && t.pc && body?.sdp?.type === 'answer') {
    await t.pc.setRemoteDescription(body.sdp);
    await addPendingCandidates(t); return;
  }
  if (kind === 'candidate' && body?.candidate) {
    if (t.pc?.remoteDescription) await t.pc.addIceCandidate(body.candidate);
    else if (t.candidates.length < 40) t.candidates.push(body.candidate);
  }
}
function installChannel(t, channel) {
  t.channel = channel;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onopen = () => {
    if (state.active !== t) return;
    armTimeout(t);
    if (t.role === 'sender') void sendFile(t).catch((err) => {
      if (state.active === t) void cancelTransfer(err.message);
    });
    else progress('수신 중', 0, t.offer.size, `${t.peerName}에서 파일을 받습니다.`);
  };
  channel.onmessage = (ev) => {
    if (state.active !== t) return;
    try { receiveMessage(t, ev.data); }
    catch (err) { void cancelTransfer(err.message); }
  };
  channel.onerror = () => { if (state.active === t) void cancelTransfer('전송 채널에 오류가 발생했습니다.'); };
}
async function sendFile(t) {
  const channel = t.channel;
  channel.send(JSON.stringify({ type: 'meta', name: t.file.name, size: t.file.size }));
  for (let offset = 0; offset < t.file.size; offset += CHUNK) {
    if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
    while (channel.bufferedAmount > 1024 * 1024) {
      if (state.active !== t || channel.readyState !== 'open') throw Error('전송이 중단되었습니다.');
      await sleep(30);
    }
    const bytes = await t.file.slice(offset, Math.min(t.file.size, offset + CHUNK)).arrayBuffer();
    channel.send(bytes);
    armTimeout(t);
    progress('파일 전송 중', Math.min(t.file.size, offset + bytes.byteLength), t.file.size, `${t.peerName}에 직접 전송 중`);
  }
  channel.send(JSON.stringify({ type: 'end' }));
  progress('저장 확인 대기', t.file.size, t.file.size, '수신 기기에서 전송 완료를 확인합니다.');
  armTimeout(t);
}
function receiveMessage(t, data) {
  if (typeof data === 'string') {
    const msg = JSON.parse(data);
    if (msg.type === 'meta' && t.role === 'receiver' && !t.started) {
      if (msg.name !== t.offer.name || msg.size !== t.offer.size) throw Error('요청 정보와 전송 파일이 다릅니다.');
      t.started = true; return;
    }
    if (msg.type === 'end' && t.role === 'receiver' && t.started && t.bytes === t.offer.size) {
      const blob = new Blob(t.received, { type: 'application/octet-stream' });
      t.received = [];
      cleanDownload(); state.blobUrl = URL.createObjectURL(blob);
      $('download-link').href = state.blobUrl;
      $('download-link').download = t.offer.name;
      $('download-title').textContent = `${t.offer.name} · ${sizeText(t.bytes)}`;
      show('transfer', false);
      show('download', true);
      $('done').focus();
      t.finished = true;
      t.channel.send(JSON.stringify({ type: 'ack' }));
      notice('수신이 완료되었습니다. 파일 저장 버튼을 눌러주세요.');
      setTimeout(() => { if (state.active === t) resetTransfer(); }, 800); return;
    }
    if (msg.type === 'ack' && t.role === 'sender') {
      notice('파일 전송이 완료되었습니다.'); resetTransfer(); return;
    }
    throw Error('예상하지 못한 전송 메시지입니다.');
  }
  if (t.role !== 'receiver' || !t.started || t.finished || !(data instanceof ArrayBuffer) ||
      t.bytes + data.byteLength > t.offer.size) throw Error('잘못된 파일 데이터가 도착했습니다.');
  t.received.push(data); t.bytes += data.byteLength; armTimeout(t);
  progress('파일 수신 중', t.bytes, t.offer.size, `${t.peerName}에서 직접 전송 중`);
}
async function loop() {
  let turn = 0;
  while (state.running && state.session) {
    try {
      const payload = await api('poll');
      for (const message of payload.messages || []) await handleSignal(message);
      setConnectionStatus('online', '로컬 연결');
      if (turn++ % 3 === 0) {
        const peers = await api('peers');
        state.peers = peers.peers || [];
        renderPeers();
      }
    } catch (err) {
      if (state.active) await cancelTransfer(`연결 오류: ${err.message}`, false);
      if (/session|expired|LAN only|HTTPS/i.test(err.message)) {
        state.running = false; setConnectionStatus('error', '연결 끊김'); notice(`연결이 끊어졌습니다. 페이지를 새로고침해주세요: ${err.message}`, true); break;
      }
      setConnectionStatus('error', '재연결 중'); notice(`연결을 다시 시도합니다: ${err.message}`, true);
    }
    await sleep(1100);
  }
}
async function start() {
  if (location.protocol !== 'https:' || !window.isSecureContext || !('RTCPeerConnection' in window)) {
    $('my-name').textContent = '내 기기';
    setConnectionStatus('error', 'HTTPS 필요');
    notice('신뢰할 수 있는 HTTPS 연결과 WebRTC 지원 브라우저가 필요합니다. 공유기의 HTTPS 인증서 상태를 확인해주세요.', true);
    return;
  }
  const defaultName = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone / iPad' :
    /Android/.test(navigator.userAgent) ? 'Android' : /Mac/.test(navigator.platform) ? 'Mac' : '내 기기';
  const name = sessionStorage.getItem('arcdrop-name') || defaultName;
  try {
    state.session = await api('register', { name });
    $('my-name').textContent = name;
    setConnectionStatus('online', '로컬 연결');
    notice('');
    void loop();
  } catch (err) { setConnectionStatus('error', '연결 실패'); notice(`연결 실패: ${err.message}`, true); }
}
$('file-input').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  const peer = state.selectedPeer;
  state.selectedPeer = null;
  if (peer && file) void beginInvite(peer, file);
});
$('accept').addEventListener('click', () => void acceptIncoming());
$('decline').addEventListener('click', () => void declineIncoming());
$('cancel').addEventListener('click', () => void cancelTransfer());
$('done').addEventListener('click', () => cleanDownload());
$('help').addEventListener('click', () => { show('help-dialog', true); $('help-close').focus(); });
$('help-close').addEventListener('click', () => show('help-dialog', false));
$('notice-dismiss').addEventListener('click', () => show('notice', false));
initTheme();
$('rename').addEventListener('click', () => {
  const previous = $('my-name').textContent;
  const value = window.prompt('표시할 기기 이름 (최대 30자)', previous);
  if (value === null) return;
  const name = value.trim().slice(0, 30);
  if (!name || new TextEncoder().encode(name).byteLength > 48) { notice('이름은 UTF-8 기준 48바이트 이하로 입력해주세요.', true); return; }
  sessionStorage.setItem('arcdrop-name', name);
  location.reload();
});
window.addEventListener('pagehide', () => {
  state.running = false;
  if (toastTimer) clearTimeout(toastTimer);
  if (state.session) {
    const data = JSON.stringify(state.session);
    navigator.sendBeacon?.(`${API}?action=leave`, new Blob([data], { type: 'application/json' }));
  }
  if (state.active) resetTransfer();
  cleanDownload();
});
void start();
