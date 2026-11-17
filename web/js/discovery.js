// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser discovery module.
import { state, discoveryBusy } from './core.js';
import { $, notice, deviceIcon } from './ui.js';
import { api } from './api.js';

// Set once by the page entry point; avoids a discovery <-> transfer import cycle.
let invitePeer = null;
export function setInviteHandler(callback) { invitePeer = callback; }

let refreshSequence = 0;

export function choosePeerFile(peer) {
  if (state.active || state.incoming) return;
  state.selectedPeer = peer;
  $('file-input').value = '';
  $('file-input').click();
}

export function handlePeerDrop(event, peer) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');
  if (state.active || state.incoming) return;
  if (!event.dataTransfer?.files || event.dataTransfer.files.length !== 1) {
    notice('전송할 파일을 하나만 선택해주세요.', true); return;
  }
  if (invitePeer) void invitePeer(peer, event.dataTransfer.files[0]);
}

export function updatePeers(peers) {
  const incoming = new Map();
  for (const peer of peers) {
    if (typeof peer?.id === 'string' && typeof peer.name === 'string' && peer.id !== state.session?.id)
      incoming.set(peer.id, peer);
  }
  const previous = state.peers.filter((peer) => incoming.has(peer.id)).map((peer) => incoming.get(peer.id));
  const oldIds = new Set(previous.map((peer) => peer.id));
  const arrivals = [...incoming.values()].filter((peer) => !oldIds.has(peer.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  const slots = state.peerSlots;
  for (const id of slots.keys()) if (!incoming.has(id)) slots.delete(id);
  for (const peer of arrivals) {
    const used = new Set(slots.values());
    for (let slot = 0; slot < 6; slot++) {
      if (!used.has(slot)) { slots.set(peer.id, slot); break; }
    }
  }
  state.peers = [...previous, ...arrivals];
  renderPeers();
}

export function peerButton(peer) {
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'peer';
  const orb = document.createElement('span'); orb.className = 'peer-orb';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', 'icon'); icon.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  icon.append(use); orb.append(icon);
  const title = document.createElement('span'); title.className = 'peer-name';
  const subtitle = document.createElement('span'); subtitle.className = 'peer-action'; subtitle.textContent = '파일 보내기';
  btn.append(orb, title, subtitle);
  const entry = { btn, use, title, subtitle, peer };
  btn.addEventListener('click', () => choosePeerFile(entry.peer));
  btn.addEventListener('dragover', (event) => {
    if (btn.disabled || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; btn.classList.add('drag-over');
  });
  btn.addEventListener('dragleave', () => btn.classList.remove('drag-over'));
  btn.addEventListener('drop', (event) => handlePeerDrop(event, entry.peer));
  return entry;
}

export function renderPeers() {
  const root = $('devices');
  const count = state.peers.length;
  $('peer-count').textContent = count ? `주변 기기 ${count}대` : '주변 기기를 찾는 중';
  $('discovery').dataset.density = count > 6 ? 'many' : 'radial';
  $('discovery').dataset.rows = String(Math.min(Math.ceil(count / 2), 6));
  const next = new Set(state.peers.map((peer) => peer.id));
  for (const peer of state.peers) {
    if (!state.peerSlots.has(peer.id)) {
      const used = new Set(state.peerSlots.values());
      for (let slot = 0; slot < 6; slot++) {
        if (!used.has(slot)) { state.peerSlots.set(peer.id, slot); break; }
      }
    }
  }
  for (const id of state.peerNodes.keys()) if (!next.has(id)) state.peerNodes.delete(id);
  const nodes = [];
  for (const peer of state.peers) {
    let entry = state.peerNodes.get(peer.id);
    if (!entry) { entry = peerButton(peer); state.peerNodes.set(peer.id, entry); }
    entry.peer = peer;
    entry.title.textContent = peer.name;
    entry.use.setAttribute('href', `#icon-${deviceIcon(peer)}`);
    // Server presence is advisory and may lag by one poll; never treat it
    // as proof that a WebRTC path is available.
    const status = ['busy', 'away', 'stale'].includes(peer.status) ? peer.status : 'available';
    const label = status === 'busy' ? '전송 중' : status === 'away' ? '자리 비움' :
      status === 'stale' ? '응답 지연' : '파일 보내기';
    entry.subtitle.textContent = label;
    entry.btn.dataset.presence = status;
    entry.btn.setAttribute('aria-label', `${peer.name} · ${label}`);
    entry.btn.disabled = discoveryBusy() || status !== 'available';
    const slot = state.peerSlots.get(peer.id);
    for (let i = 0; i < 6; i++) entry.btn.classList.toggle(`peer-slot-${i}`, count <= 6 && slot === i);
    nodes.push(entry.btn);
  }
  // Preserve focus/drag state: reattach only when membership/order changes.
  if (root.children.length !== nodes.length || nodes.some((node, i) => root.children[i] !== node))
    root.replaceChildren(...nodes);
}

export async function refreshPeers() {
  const sequence = ++refreshSequence;
  const session = state.session;
  const response = await api('peers');
  if (state.session === session && sequence === refreshSequence) updatePeers(response.peers || []);
}
