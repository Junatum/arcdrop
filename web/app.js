/* ArcDrop browser bootstrap - original independent implementation, GPL-3.0-or-later. */
import { state, wakePoll, DEVICE_TYPES } from './js/core.js';
import { $, notice, show, initTheme, displayProfile, clearToast } from './js/ui.js';
import { api } from './js/api.js';
import { setInviteHandler } from './js/discovery.js';
import { beginInvite, acceptIncoming, declineIncoming, cancelTransfer, cleanDownload, startDownloadCountdown, resetTransfer } from './js/transfer.js';
import { start, resumeDiscovery, savedProfile, validName, storageWrite, browserStorage } from './js/session.js';

setInviteHandler(beginInvite);
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
$('download-link').addEventListener('click', () => startDownloadCountdown());
$('help').addEventListener('click', () => { show('help-dialog', true); $('help-close').focus(); });
$('help-close').addEventListener('click', () => show('help-dialog', false));
$('notice-dismiss').addEventListener('click', () => show('notice', false));
initTheme();
$('rename').addEventListener('click', () => {
  const profile = savedProfile();
  $('device-name').value = profile.name;
  $('device-type').value = profile.deviceType;
  show('device-dialog', true);
  $('device-name').focus();
});
$('device-cancel').addEventListener('click', () => show('device-dialog', false));
$('device-save').addEventListener('click', async () => {
  const name = $('device-name').value.trim();
  const deviceType = $('device-type').value;
  if (!validName(name) || !DEVICE_TYPES.includes(deviceType)) {
    notice('기기 이름은 30자, UTF-8 48바이트 이하여야 합니다.', true); return;
  }
  const save = $('device-save');
  if (save.disabled) return;
  save.disabled = true;
  try {
    if (!state.session) throw new Error('기기 연결을 먼저 확인해주세요.');
    await api('profile', {name, deviceType});
    storageWrite(browserStorage('localStorage'), 'arcdrop-name', name);
    storageWrite(browserStorage('localStorage'), 'arcdrop-device-type', deviceType);
    storageWrite(browserStorage('sessionStorage'), 'arcdrop-name', name);
    displayProfile({name, deviceType});
    show('device-dialog', false);
  } catch (err) { show('device-dialog', false); notice(`기기 설정 저장 실패: ${err.message}`, true); }
  finally { save.disabled = false; }
});
// pagehide also fires on reload and browser back-forward cache. Keep the
// tab-scoped token for 45 seconds rather than sending a racing leave beacon.
window.addEventListener('pagehide', () => {
  state.running = false;
  ++state.loopId;
  wakePoll();
  clearToast();
  if (state.active) resetTransfer();
  cleanDownload();
});
document.addEventListener('visibilitychange', () => {
  wakePoll();
  if (document.visibilityState === 'visible') void resumeDiscovery();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void resumeDiscovery();
});
window.addEventListener('online', () => void resumeDiscovery());
void start();
