/* ArcDrop visual preview only. No CGI/WebRTC/network operations. GPL-3.0-or-later. */
'use strict';
const $ = (id) => document.getElementById(id);
const SAMPLE_PEERS = [
  { id: 'preview-a', name: 'iPhone 17', icon: 'phone' },
  { id: 'preview-b', name: 'Windows PC', icon: 'desktop' },
  { id: 'preview-c', name: 'iPad Air', icon: 'tablet' },
];
const dialogIds = ['incoming', 'transfer', 'download', 'help-dialog'];
let selectedPeer = null;
function show(id, value) {
  $(id).classList.toggle('hidden', !value);
  document.body.classList.toggle('modal-open', !!document.querySelector('.dialog-backdrop:not(.hidden)'));
}
function closeDialogs() { for (const id of dialogIds) show(id, false); }
function renderPeers(peers) {
  $('devices').replaceChildren();
  $('discovery').dataset.density = 'radial';
  $('discovery').dataset.empty = peers.length ? 'false' : 'true';
  $('discovery').dataset.rows = String(Math.min(Math.ceil(peers.length / 2), 6));
  $('peer-count').textContent = peers.length ? `주변 기기 ${peers.length}대` : '주변 기기를 찾는 중';
  for (const [index, peer] of peers.entries()) {
    const btn = document.createElement('button');
    btn.className = 'peer'; btn.type = 'button';
    btn.setAttribute('aria-label', `${peer.name}에 파일 보내기`);
    if (peers.length <= 6) btn.classList.add(`peer-pos-${peers.length}-${index}`);
    const orb = document.createElement('span'); orb.className = 'peer-orb';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon'); svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${peer.icon}`); svg.append(use); orb.append(svg);
    const name = document.createElement('span'); name.className = 'peer-name'; name.textContent = peer.name;
    const hint = document.createElement('span'); hint.className = 'peer-action'; hint.textContent = '파일 보내기';
    btn.append(orb, name, hint);
    btn.addEventListener('click', () => { selectedPeer = peer; $('file-input').value = ''; $('file-input').click(); });
    $('devices').append(btn);
  }
}
function preview(mode) {
  closeDialogs();
  show('notice', false);
  $('discovery').dataset.status = 'online';
  $('connection-status').dataset.status = 'online';
  $('connection-label').textContent = '디자인 데모';
  if (mode === 'empty') renderPeers([]);
  else renderPeers(SAMPLE_PEERS);
  if (mode === 'incoming') {
    $('incoming-title').textContent = 'iPhone 17에서 파일을 보내려고 합니다.';
    $('incoming-detail').textContent = '여행사진.jpg · 2.4 MiB (데모 데이터)';
    show('incoming', true);
  } else if (mode === 'transfer') {
    $('transfer-title').textContent = '파일 전송 중';
    $('transfer-percent').textContent = '68%';
    $('transfer-progress').setAttribute('aria-valuenow', '68');
    $('transfer-progress').value = 68;
    $('transfer-detail').textContent = 'iPhone 17로 파일을 보내는 화면 예시입니다.';
    show('transfer', true);
  } else if (mode === 'complete') {
    $('download-title').textContent = '여행사진.jpg · 2.4 MiB (데모 데이터)';
    $('download-link').classList.add('hidden');
    show('download', true);
  } else if (mode === 'error') {
    $('connection-status').dataset.status = 'error';
    $('connection-label').textContent = 'HTTPS 필요';
    $('discovery').dataset.status = 'error';
    $('notice-text').textContent = '실제 전송에는 신뢰할 수 있는 HTTPS 연결이 필요합니다. 이 화면은 디자인 데모입니다.';
    $('notice').classList.add('error');
    show('notice', true);
  }
  for (const btn of document.querySelectorAll('[data-demo]'))
    btn.classList.toggle('active', btn.dataset.demo === mode);
}
function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('arcdrop-theme') === 'light' ? 'light' : 'dark'; }
  catch { /* preview must work even without storage */ }
  document.documentElement.dataset.theme = theme;
  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('arcdrop-theme', next); } catch { /* blocked */ }
  });
}
$('my-name').textContent = 'MacBook Pro';
$('rename').addEventListener('click', () => {
  const proposed = window.prompt('데모 기기 이름', $('my-name').textContent);
  if (proposed && proposed.trim()) $('my-name').textContent = proposed.trim().slice(0, 30);
});
$('file-input').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file || !selectedPeer) return;
  preview('transfer');
  $('transfer-detail').textContent = `${selectedPeer.name} · ${file.name} (데모: 실제 파일을 전송하지 않습니다)`;
  selectedPeer = null;
});
for (const btn of document.querySelectorAll('[data-demo]'))
  btn.addEventListener('click', () => preview(btn.dataset.demo));
$('help').addEventListener('click', () => show('help-dialog', true));
$('help-close').addEventListener('click', () => show('help-dialog', false));
$('accept').addEventListener('click', () => preview('transfer'));
$('decline').addEventListener('click', () => preview('peers'));
$('cancel').addEventListener('click', () => preview('peers'));
$('done').addEventListener('click', () => preview('peers'));
$('download-link').addEventListener('click', (event) => event.preventDefault());
$('notice-dismiss').addEventListener('click', () => show('notice', false));
initTheme();
preview('peers');
