// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser ui module.
import { state, DEVICE_TYPES } from './core.js';

export const $ = (id) => document.getElementById(id);

let toastTimer = null;

export function setConnectionStatus(status, label) {
  $('connection-status').dataset.status = status;
  $('connection-label').textContent = label;
  $('discovery').dataset.status = status;
}

export function show(id, visible) {
  $(id).classList.toggle('hidden', !visible);
  document.body.classList.toggle('modal-open', !!document.querySelector('.dialog-backdrop:not(.hidden)'));
}

export function notice(message, error = false) {
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

export function progress(title, current, total, details) {
  $('transfer-title').textContent = title;
  const percentage = total > 0 ? Math.min(100, Math.round(current * 100 / total)) : 100;
  $('transfer-percent').textContent = `${percentage}%`;
  $('transfer-progress').value = percentage;
  $('transfer-progress').setAttribute('aria-valuenow', String(percentage));
  $('transfer-detail').textContent = details;
  show('transfer', true);
}

export function deviceIcon(peer) {
  // Explicit device type is independent of the user-editable display name.
  if (DEVICE_TYPES.includes(peer.deviceType)) return peer.deviceType;
  // Compatibility with sessions created by an older ArcDrop version.
  const name = peer.name || '';
  if (/ipad|tablet|tab\b/i.test(name)) return 'tablet';
  if (/iphone|android|phone|pixel|galaxy/i.test(name)) return 'phone';
  if (/macbook|laptop|notebook/i.test(name)) return 'laptop';
  return 'desktop';
}

export function displayProfile(profile) {
  $('my-name').textContent = profile.name;
  const use = document.querySelector('.self-orb use');
  if (use) use.setAttribute('href', `#icon-${profile.deviceType}`);
}

export function initTheme() {
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


export function clearToast() { if (toastTimer) clearTimeout(toastTimer); }
