// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser api module.
import { API, state } from './core.js';

export async function api(action, extra = {}) {
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

export async function signal(to, kind, body = {}) { return api('signal', { to, kind, body }); }
