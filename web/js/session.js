// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser session module.
import { state, discoveryBusy, pollWait, wakePoll, DEVICE_TYPES } from './core.js';
import { $, setConnectionStatus, displayProfile, notice } from './ui.js';
import { api } from './api.js';
import { refreshPeers } from './discovery.js';
import { cancelTransfer } from './transfer.js';
import { handleSignal } from './signaling.js';

export const POLL_ACTIVE_MS = 700;

export const POLL_IDLE_MS = 1800;

export const POLL_HIDDEN_MS = 12000;

export const PEERS_ACTIVE_MS = 3500;

export const PEERS_IDLE_MS = 6500;

export let connectPromise = null;

// IDs stay in memory for this tab only. 128 entries bounds duplicate tracking.
const seenSignals = new Set();
let pendingAcks = [];

export function resetSignalTracking() { seenSignals.clear(); pendingAcks = []; }

export function acknowledgeSignal(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) return;
  if (!seenSignals.has(id)) {
    if (seenSignals.size >= 128) seenSignals.delete(seenSignals.values().next().value);
    seenSignals.add(id);
  }
  if (!pendingAcks.includes(id)) pendingAcks.push(id);
}


export function pollInterval() {
  if (discoveryBusy()) return POLL_ACTIVE_MS;
  return document.visibilityState === 'hidden' ? POLL_HIDDEN_MS : POLL_IDLE_MS;
}

export function peerRefreshInterval() { return discoveryBusy() ? PEERS_ACTIVE_MS : PEERS_IDLE_MS; }

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const touch = navigator.maxTouchPoints || 0;
  // Since iPadOS 13, Safari can report Macintosh / MacIntel like a Mac.
  if (/iPad/i.test(ua) || ((/Macintosh/i.test(ua) || /MacIntel/i.test(platform)) && touch > 1))
    return { name: 'iPad', deviceType: 'tablet' };
  if (/iPhone|iPod/i.test(ua)) return { name: 'iPhone', deviceType: 'phone' };
  if (/Android/i.test(ua)) return /Mobile/i.test(ua)
    ? { name: 'Android Phone', deviceType: 'phone' }
    : { name: 'Android Tablet', deviceType: 'tablet' };
  // Browser privacy APIs do not reliably identify exact Mac hardware models.
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return { name: 'Mac', deviceType: 'desktop' };
  if (/Windows/i.test(ua) || /Win/i.test(platform)) return { name: 'Windows PC', deviceType: 'desktop' };
  if (/Linux/i.test(ua) || /Linux/i.test(platform)) return { name: 'Linux PC', deviceType: 'desktop' };
  return { name: '내 기기', deviceType: 'desktop' };
}
// Session tokens are tab-scoped; device preferences are optional and untrusted.

export function browserStorage(kind) { try { return globalThis[kind] || null; } catch { return null; } }

export function storageRead(store, key) { try { return store?.getItem(key) || null; } catch { return null; } }

export function storageWrite(store, key, value) { try { if (value === null) store?.removeItem(key); else store?.setItem(key, value); } catch { /* private mode */ } }

export function savedProfile() {
  const automatic = detectDevice();
  const name = storageRead(browserStorage('localStorage'), 'arcdrop-name') || storageRead(browserStorage('sessionStorage'), 'arcdrop-name');
  const kind = storageRead(browserStorage('localStorage'), 'arcdrop-device-type');
  return { name: validName(name) ? name : automatic.name,
    deviceType: DEVICE_TYPES.includes(kind) ? kind : automatic.deviceType };
}

export function validName(name) {
  return typeof name === 'string' && !!name.trim() && name.length <= 30 &&
    new TextEncoder().encode(name).byteLength <= 48;
}

export function storedSession() {
  try {
    const parsed = JSON.parse(storageRead(browserStorage('sessionStorage'), 'arcdrop-session') || 'null');
    if (/^[0-9a-f]{24}$/.test(parsed?.id) && /^[0-9a-f]{48}$/.test(parsed?.token)) return parsed;
  } catch { /* invalid or disabled session storage */ }
  return null;
}

export function persistSession(session) {
  storageWrite(browserStorage('sessionStorage'), 'arcdrop-session', session ? JSON.stringify(session) : null);
}

export function invalidSession(err) { return /invalid or expired session|invalid session/i.test(err?.message || ''); }

export async function ensureSession() {
  if (connectPromise) return connectPromise;
  connectPromise = (async () => {
    const profile = savedProfile();
    displayProfile(profile);
    if (!state.session) state.session = storedSession();
    if (state.session) {
      try { await api('heartbeat'); }
      catch (err) {
        if (!invalidSession(err)) throw err;
        state.session = null;
        resetSignalTracking();
        persistSession(null);
      }
    }
    if (!state.session) {
      resetSignalTracking();
      state.session = await api('register', profile);
      persistSession(state.session);
    }
    setConnectionStatus('online', '로컬 연결');
    notice('');
    await refreshPeers();
    if (!state.running) {
      state.running = true;
      const loopId = ++state.loopId;
      void loop(loopId);
    }
  })().finally(() => { connectPromise = null; });
  return connectPromise;
}

export async function loop(loopId) {
  let lastPeerRefresh = Date.now();
  let failures = 0;
  while (state.running && state.session && state.loopId === loopId) {
    const session = state.session;
    let delay = pollInterval();
    try {
      const acks = pendingAcks.slice(0, 32);
      const payload = await api('poll', {
        visible: document.visibilityState !== 'hidden', busy: discoveryBusy(), acks,
      });
      if (!state.running || state.loopId !== loopId || session !== state.session) return;
      // The server removes only acknowledged messages. A lost response may
      // redeliver the same ID; never repeat its UI or WebRTC side effects.
      pendingAcks = pendingAcks.filter((id) => !acks.includes(id));
      for (const message of payload.messages || []) {
        if (message?.id && seenSignals.has(message.id)) {
          acknowledgeSignal(message.id);
          continue;
        }
        try { await handleSignal(message); }
        catch (err) {
          console.warn('ArcDrop: signaling message failed', message?.kind || 'unknown', err?.message || err);
          if (state.active?.peerId === message?.from)
            await cancelTransfer(`연결 협상 실패: ${err?.message || '알 수 없는 오류'}`);
          else notice(`기기 연결 요청 처리 실패: ${err?.message || '알 수 없는 오류'}`, true);
        } finally { acknowledgeSignal(message?.id); }
      }
      if (failures) notice('');
      failures = 0;
      setConnectionStatus('online', '로컬 연결');
      if (document.visibilityState !== 'hidden' &&
          Date.now() - lastPeerRefresh >= peerRefreshInterval()) {
        try { await refreshPeers(); lastPeerRefresh = Date.now(); }
        catch (err) {
          if (invalidSession(err)) throw err;
          console.warn('ArcDrop: peer discovery refresh failed', err?.message || 'unknown');
        }
      }
      delay = pollInterval();
    } catch (err) {
      if (state.loopId !== loopId) return;
      if (invalidSession(err)) {
        state.running = false;
        state.session = null;
        resetSignalTracking();
        persistSession(null);
        setConnectionStatus('error', '세션 복구 중');
        if (document.visibilityState !== 'hidden' && navigator.onLine !== false)
          void ensureSession().catch((error) => {
            setConnectionStatus('error', '재연결 대기'); notice(`연결 복구 실패: ${error.message}`, true);
          });
        return;
      }
      // Transient CGI polling errors do not mean the direct data channel
      // failed. Keep an ongoing transfer alive and let its own timeout decide.
      failures++;
      delay = Math.min(12000, 1800 * (2 ** Math.min(3, failures - 1)));
      if (failures === 1) setConnectionStatus('error', '재연결 중');
      if (failures === 2) notice(`서버 연결 재시도 중: ${err.message}`, true);
    }
    if (!state.running || state.loopId !== loopId) return;
    await pollWait(delay);
  }
}

export async function resumeDiscovery() {
  if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
  try { await ensureSession(); wakePoll(); }
  catch (err) { setConnectionStatus('error', '재연결 대기'); notice(`연결 복구 실패: ${err.message}`, true); }
}

export async function start() {
  if (location.protocol !== 'https:' || !window.isSecureContext || !('RTCPeerConnection' in window)) {
    $('my-name').textContent = '내 기기';
    setConnectionStatus('error', 'HTTPS 필요');
    notice('신뢰할 수 있는 HTTPS 연결과 WebRTC 지원 브라우저가 필요합니다. 공유기의 HTTPS 인증서 상태를 확인해주세요.', true);
    return;
  }
  await resumeDiscovery();
}
