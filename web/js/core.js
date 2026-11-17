// SPDX-License-Identifier: GPL-3.0-or-later
// ArcDrop browser core module.

export const LIMIT = 64 * 1024 * 1024;

export const CHUNK = 16 * 1024;

export const API = '/cgi-bin/arcdrop';

export const state = { session: null, peers: [], active: null, incoming: null, selectedPeer: null, blobUrl: null, running: false, loopId: 0, peerSlots: new Map(), peerNodes: new Map() };

export const DEVICE_TYPES = ['phone', 'tablet', 'laptop', 'desktop'];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const sizeText = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : `${(n / 1024).toFixed(1)} KiB`;

export let pollWake = null;

export function pollWait(ms) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => { clearTimeout(timer); if (pollWake === finish) pollWake = null; resolve(); };
    pollWake = finish;
    timer = setTimeout(finish, ms);
  });
}

export function wakePoll() { if (pollWake) pollWake(); }

export function discoveryBusy() { return !!(state.active || state.incoming); }
