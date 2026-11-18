// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser api module.
import { API, state, sleep } from './core.js';

export const API_TIMEOUT_MS = 10000;
export const SIGNAL_TIMEOUT_MS = 15000;

export async function api(action, extra = {}, timeoutMs = null) {
  const data = state.session ? { id: state.session.id, token: state.session.token, ...extra } : extra;
  const controller = new AbortController();
  const duration = timeoutMs ?? (action === 'signal' ? SIGNAL_TIMEOUT_MS : API_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), duration);
  let response;
  let payload;
  try {
    response = await fetch(`${API}?action=${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), cache: 'no-store', credentials: 'same-origin',
      signal: controller.signal,
    });
    try { payload = await response.json(); }
    catch { throw new Error('서버 응답을 읽지 못했습니다.'); }
  } catch (err) {
    if (controller.signal.aborted) {
      const error = new Error('서버 요청 시간이 초과되었습니다.');
      error.name = 'TimeoutError';
      throw error;
    }
    throw err;
  } finally { clearTimeout(timeout); }
  if (!response.ok) {
    const error = new Error(payload.error || `연결 오류 (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

// Use the same request ID after uncertain transport failures, so the CGI can
// return success without enqueueing a second invitation or acceptance.
export function newSignalId() {
  if (!globalThis.crypto?.getRandomValues) return null;
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signal(to, kind, body = {}, transferId = null) {
  const requestId = newSignalId();
  const request = { to, kind, body };
  if (requestId) request.requestId = requestId;
  if (transferId) request.transferId = transferId;
  for (let attempt = 0; ; attempt++) {
    try { return await api('signal', request); }
    catch (err) {
      // Do not retry authorization failures, queue-full responses or errors
      // without an idempotency key. A transient failure may mean success.
      const transient = err instanceof TypeError || err?.name === 'TimeoutError' || [502, 503, 504].includes(err?.status);
      if (!requestId || !transient || attempt >= 2) throw err;
      await sleep(250 * (attempt + 1));
    }
  }
}
