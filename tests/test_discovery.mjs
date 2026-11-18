// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { browserTestSource } from '../tools/browser_vm.mjs';
const root = resolve(import.meta.dirname, '..');
const app = browserTestSource(root);
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const demo = readFileSync(resolve(root, 'web/demo.html'), 'utf8');
const css = readFileSync(resolve(root, 'web/style.css'), 'utf8');

class Classes {
  constructor() { this.values = new Set(['hidden']); }
  add(n) { this.values.add(n); }
  remove(n) { this.values.delete(n); }
  toggle(n, force) { if (force === undefined ? !this.values.has(n) : force) this.add(n); else this.remove(n); }
  contains(n) { return this.values.has(n); }
}
class Element {
  constructor() {
    this.children = []; this.classList = new Classes(); this.attrs = {}; this.dataset = {};
    this.listeners = new Map(); this.disabled = false; this.value = ''; this.textContent = '';
  }
  addEventListener(name, cb) { this.listeners.set(name, cb); }
  dispatch(name, ev = {}) { return this.listeners.get(name)?.(ev); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  getAttribute(name) { return this.attrs[name]; }
  click() { this.dispatch('click'); }
  focus() { this.focused = true; }
}
function memoryStore(values = {}, blocked = false) {
  const data = new Map(Object.entries(values));
  return {
    getItem(k) { if (blocked) throw Error('Storage disabled'); return data.get(k) ?? null; },
    setItem(k, v) { if (blocked) throw Error('Storage disabled'); data.set(k, String(v)); },
    removeItem(k) { if (blocked) throw Error('Storage disabled'); data.delete(k); },
    data,
  };
}
function setup({ blocked = false, local = {}, tab = {}, responses = {}, channelBus = null } = {}) {
  const nodes = new Map();
  const get = (name) => { if (!nodes.has(name)) nodes.set(name, new Element()); return nodes.get(name); };
  const windowEvents = new Map(); const documentEvents = new Map();
  const selfIcon = new Element();
  const localStorage = memoryStore(local, blocked); const sessionStorage = memoryStore(tab, blocked);
  const requests = [];
  const navigator = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0, onLine: true };
  const document = {
    visibilityState: 'visible', getElementById: get, createElement: () => new Element(),
    createElementNS: () => new Element(), querySelector: (s) => s === '.self-orb use' ? selfIcon : null,
    documentElement: { dataset: {} }, body: { classList: new Classes() },
    addEventListener: (k, fn) => documentEvents.set(k, fn),
  };
  const window = { isSecureContext: false, addEventListener: (k, fn) => windowEvents.set(k, fn) };
  const location = { protocol: 'http:' };
  const fetch = async (url, config) => {
    const action = new URL(url, 'https://router.test').searchParams.get('action');
    requests.push({action, data: JSON.parse(config.body)});
    const response = responses[action] || { status: 200, body: action === 'register'
      ? {id: 'a'.repeat(24), token: 'b'.repeat(48)} : action === 'peers' ? {peers: []} : {} };
    return { ok: response.status < 400, status: response.status, json: async () => response.body };
  };
  const BroadcastChannel = channelBus ? class {
    constructor() { this.onmessage = null; channelBus.push(this); }
    postMessage(message) {
      for (const peer of channelBus) if (peer !== this) peer.onmessage?.({data: message});
    }
    close() { const pos = channelBus.indexOf(this); if (pos >= 0) channelBus.splice(pos, 1); }
  } : undefined;
  const context = vm.createContext({ window, document, location, navigator, fetch, localStorage, sessionStorage,
    setTimeout, clearTimeout, console, TextEncoder, Blob, AbortController, BroadcastChannel,
    crypto: {getRandomValues(bytes) { bytes.fill(0xaa); return bytes; }} });
  vm.runInContext(app, context, {filename: 'app.js'});
  // The unit test controls polling explicitly to avoid asynchronous timers.
  vm.runInContext('globalThis.__realLoop = loop; loop = async () => {}', context);
  return {context, get, requests, responses, sessionStorage, localStorage, windowEvents, documentEvents,
    document, location, window, selfIcon};
}
const evaluate = (runtime, code) => vm.runInContext(code, runtime.context);

const PEERS = [
  {id:'a',name:'iPad',deviceType:'tablet'},
  {id:'b',name:'MacBook',deviceType:'laptop'},
  {id:'c',name:'Windows',deviceType:'desktop'},
];

test('기기 목록 순서가 바뀌어도 DOM과 방사형 위치가 유지된다', () => {
  const t = setup();
  t.context.peers1 = PEERS;
  evaluate(t, 'updatePeers(peers1)');
  const before = [...t.get('devices').children];
  assert.equal(before.length, 3);
  const slots = before.map((btn) => [...btn.classList.values].filter((c) => c.startsWith('peer-slot-')));
  t.context.peers2 = [...PEERS].reverse();
  evaluate(t, 'updatePeers(peers2)');
  assert.deepEqual([...t.get('devices').children], before);
  assert.deepEqual(before.map((btn) => [...btn.classList.values].filter((c) => c.startsWith('peer-slot-'))), slots);
  before[0].classList.add('drag-over');
  evaluate(t, 'updatePeers(peers2)');
  assert.equal(before[0].classList.contains('drag-over'), true, '드래그 CSS 유지');
  t.context.peers3 = [...PEERS, {id:'d',name:'Android',deviceType:'phone'}];
  evaluate(t, 'updatePeers(peers3)');
  assert.deepEqual(t.get('devices').children.slice(0,3), before);
  assert.equal(t.get('devices').children.length, 4);
});

test('주변 기기가 사라지면 해당 버튼만 제거하고 나머지 위치를 유지한다', () => {
  const t = setup(); t.context.list = PEERS;
  evaluate(t, 'updatePeers(list)');
  const first = t.get('devices').children[0];
  const last = t.get('devices').children[2];
  t.context.remaining = [PEERS[2], PEERS[0]];
  evaluate(t, 'updatePeers(remaining)');
  assert.equal(t.get('devices').children.length, 2);
  assert.equal(t.get('devices').children[0], first);
  assert.equal(t.get('devices').children[1], last);
});

test('새로고침 후 기존 탭 세션을 재사용하고 register를 중복 호출하지 않는다', async () => {
  const saved = { id:'1'.repeat(24), token:'2'.repeat(48) };
  const t = setup({ tab: {'arcdrop-session': JSON.stringify(saved)} });
  await evaluate(t, 'ensureSession()');
  assert.deepEqual(t.requests.map((x) => x.action), ['heartbeat','peers']);
  assert.equal(evaluate(t, 'state.session.id'), saved.id);
});

test('만료된 세션은 자동 갱신하고 새로운 세션을 탭에 보존한다', async () => {
  const saved = { id:'1'.repeat(24), token:'2'.repeat(48) };
  const t = setup({ tab: {'arcdrop-session': JSON.stringify(saved)}, responses: {
    heartbeat: { status:403, body: {error:'invalid or expired session'} },
  }});
  await evaluate(t, 'ensureSession()');
  assert.deepEqual(t.requests.map((x) => x.action), ['heartbeat','register','peers']);
  assert.equal(evaluate(t, 'state.session.id'), 'a'.repeat(24));
  assert.match(t.sessionStorage.getItem('arcdrop-session'), /a{24}/);
});

test('브라우저 저장소 접근이 차단되어도 등록과 기기 표시가 동작한다', async () => {
  const t = setup({ blocked:true });
  await evaluate(t, 'ensureSession()');
  assert.deepEqual(t.requests.map((x) => x.action), ['register','peers']);
  assert.equal(t.get('my-name').textContent, 'Mac');
  assert.equal(t.selfIcon.attrs.href, '#icon-desktop');
});

test('iPad 백그라운드 복귀와 온라인 복귀는 heartbeat로 기존 세션을 유지한다', async () => {
  const t = setup();
  await evaluate(t, 'ensureSession()');
  const beforeId = evaluate(t, 'state.session.id');
  t.requests.length = 0;
  // Simulate pagehide, BFCache restoration, then network connectivity event.
  t.windowEvents.get('pagehide')();
  t.windowEvents.get('pageshow')({ persisted:true });
  await evaluate(t, 'connectPromise');
  assert.equal(evaluate(t, 'state.session.id'), beforeId);
  assert.deepEqual(t.requests.map((r) => r.action), ['heartbeat','peers']);
  t.requests.length = 0;
  t.windowEvents.get('online')();
  await evaluate(t, 'connectPromise');
  assert.deepEqual(t.requests.map((r) => r.action), ['heartbeat','peers']);
  assert.equal(t.requests.filter((x) => x.action === 'register').length, 0);
});

test('프로필 저장은 서버 세션 ID를 바꾸지 않고 기기 이름·아이콘을 갱신한다', async () => {
  const t = setup(); await evaluate(t, 'ensureSession()');
  t.get('rename').dispatch('click');
  t.get('device-name').value = 'iPad Pro';
  t.get('device-type').value = 'tablet';
  const id = evaluate(t, 'state.session.id');
  await t.get('device-save').dispatch('click');
  assert.equal(t.requests.at(-1).action, 'profile');
  assert.equal(t.requests.at(-1).data.name, 'iPad Pro');
  assert.equal(t.requests.at(-1).data.deviceType, 'tablet');
  assert.equal(evaluate(t, 'state.session.id'), id);
  assert.equal(t.selfIcon.attrs.href, '#icon-tablet');
  assert.equal(t.get('my-name').textContent, 'iPad Pro');
  assert.equal(t.localStorage.getItem('arcdrop-device-type'), 'tablet');
});

test('운영 및 데모 화면은 공통 기기 설정 모달을 사용하며 CSP를 완화하지 않는다', () => {
  for (const markup of [html,demo]) {
    for (const item of ['device-dialog','device-name','device-type','device-save','device-cancel'])
      assert.match(markup, new RegExp(`id="${item}"`));
    assert.match(markup, /style-src 'self'/);
    assert.doesNotMatch(markup, /unsafe-inline|style=/);
  }
  for (const name of ['peer-slot-0','peer-slot-5','.device-label','.device-field']) assert.ok(css.includes(name));
  assert.doesNotMatch(app, /sendBeacon/);
  assert.match(app, /visibilitychange/);
  assert.match(app, /pageshow/);
  assert.match(app, /event\.persisted/);
});

test('기기 유형 저장값은 허용된 유형만 복원하며 잘못된 값은 기본 유형으로 대체한다', () => {
  const t = setup({ local: { 'arcdrop-name': 'My Tablet', 'arcdrop-device-type': 'tablet' } });
  assert.equal(evaluate(t, 'savedProfile().name'), 'My Tablet');
  assert.equal(evaluate(t, 'savedProfile().deviceType'), 'tablet');
  t.localStorage.setItem('arcdrop-device-type', 'unknown');
  assert.equal(evaluate(t, 'savedProfile().deviceType'), 'desktop');
});

test('스토리지 getter 자체가 예외를 던져도 기기 등록은 성공한다', async () => {
  const t = setup();
  Object.defineProperty(t.context, 'localStorage', { get() { throw new Error('denied'); } });
  Object.defineProperty(t.context, 'sessionStorage', { get() { throw new Error('denied'); } });
  await evaluate(t, 'ensureSession()');
  assert.deepEqual(t.requests.map((x) => x.action), ['register','peers']);
  assert.equal(evaluate(t, 'state.session.id'), 'a'.repeat(24));
});


test('폴링 간격은 대기·전송·백그라운드 상태에 따라 조절된다', () => {
  const t = setup();
  assert.equal(evaluate(t, 'pollInterval()'), 1800);
  assert.equal(evaluate(t, 'peerRefreshInterval()'), 6500);
  t.document.visibilityState = 'hidden';
  assert.equal(evaluate(t, 'pollInterval()'), 12000);
  evaluate(t, 'state.incoming = {from: "peer"}');
  assert.equal(evaluate(t, 'pollInterval()'), 700);
  assert.equal(evaluate(t, 'peerRefreshInterval()'), 3500);
});

test('실제 폴링은 선택적인 가시성 및 전송 상태를 서버로 전달한다', async () => {
  const t = setup(); await evaluate(t, 'ensureSession()');
  t.requests.length = 0;
  // Execute the real production loop once, without sleeping in the test.
  evaluate(t, 'pollWait = async () => { state.running = false; }');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.equal(t.requests[0].action, 'poll');
  assert.equal(t.requests[0].data.visible, true);
  assert.equal(t.requests[0].data.busy, false);
  t.document.visibilityState = 'hidden';
  evaluate(t, 'state.running = true; state.active = { peerId:"x" }');
  t.requests.length = 0;
  await evaluate(t, '__realLoop(state.loopId)');
  assert.equal(t.requests[0].data.visible, false);
  assert.equal(t.requests[0].data.busy, true);
});

test('주변 기기의 전송 중·자리 비움·응답 지연 상태를 별도로 표시한다', () => {
  const t = setup();
  for (const [status, label, disabled] of [
    ['available','파일 보내기',false], ['busy','전송 중',true],
    ['away','자리 비움',true], ['stale','응답 지연',true],
  ]) {
    t.context.list = [{id:'test',name:'iPad',deviceType:'tablet',status}];
    evaluate(t, 'updatePeers(list)');
    const peer = t.get('devices').children[0];
    assert.equal(peer.dataset.presence, status);
    assert.equal(peer.children[2].textContent, label);
    assert.equal(peer.disabled, disabled);
  }
  // Older clients' rows have no presence field; do not lock them out.
  t.context.list = [{id:'test',name:'Old Peer'}];
  evaluate(t, 'updatePeers(list)');
  assert.equal(t.get('devices').children[0].disabled, false);
});

test('일시적인 CGI poll 오류는 전송 중 WebRTC 채널을 취소하지 않는다', async () => {
  const t = setup({responses: {poll: {status: 503, body: {error:'temporary outage'}}}});
  await evaluate(t, 'ensureSession()');
  evaluate(t, 'state.active = {peerId:"ipad",role:"sender"}');
  evaluate(t, 'pollWait = async () => { state.running = false; }');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.equal(evaluate(t, 'state.active.peerId'), 'ipad');
  assert.equal(t.get('connection-label').textContent, '재연결 중');
});

test('모바일이 다시 표시되면 느린 백그라운드 폴링 대기를 깨운다', async () => {
  const t = setup(); await evaluate(t, 'ensureSession()');
  evaluate(t, 'globalThis.__waitResult = pollWait(12000)');
  t.document.visibilityState = 'visible';
  t.documentEvents.get('visibilitychange')();
  await evaluate(t, '__waitResult');
  assert.equal(evaluate(t, 'pollWake'), null);
  // A visible tab should validate its existing session, not register again.
  await evaluate(t, 'connectPromise');
  assert.equal(t.requests.filter((item) => item.action === 'register').length, 1);
});

test('CGI 연속 실패는 요청 간격을 늘리고 최대 12초로 제한한다', async () => {
  const t = setup({responses: {poll: {status: 503, body: {error:'temporary outage'}}}});
  await evaluate(t, 'ensureSession()');
  evaluate(t, `globalThis.__delays = [];
    pollWait = async (delay) => {
      __delays.push(delay);
      if (__delays.length === 4) state.running = false;
    };`);
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual(Array.from(evaluate(t, '__delays')), [1800, 3600, 7200, 12000]);
  assert.equal(t.requests.filter((request) => request.action === 'poll').length, 4);
});

test('주변 기기 목록 조회 실패는 정상 파일 전송이나 신호 폴링을 취소하지 않는다', async () => {
  const t = setup();
  await evaluate(t, 'ensureSession()');
  t.responses.peers = {status:503, body:{error:'peer discovery temporarily unavailable'}};
  t.context.Date = { now: (() => { let reads = 0; return () => reads++ === 0 ? 0 : 10000; })() };
  evaluate(t, `state.active = {peerId:'ipad', role:'sender'};
    pollWait = async () => { state.running = false; };`);
  await evaluate(t, '__realLoop(state.loopId)');
  assert.equal(evaluate(t, 'state.active.peerId'), 'ipad');
  assert.equal(t.get('connection-label').textContent, '로컬 연결');
  assert.ok(t.requests.some((request) => request.action === 'peers'));
});


test('백그라운드에서는 기기 목록 조회를 생략해 공유기 부하를 줄인다', async () => {
  const t = setup();
  await evaluate(t, 'ensureSession()');
  t.requests.length = 0;
  t.document.visibilityState = 'hidden';
  t.context.Date = { now: (() => { let reads = 0; return () => reads++ === 0 ? 0 : 100000; })() };
  evaluate(t, 'pollWait = async () => { state.running = false; }');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual(t.requests.map((request) => request.action), ['poll']);
  assert.equal(t.requests[0].data.visible, false);
});

test('수신 초대가 방치되면 자동 만료되고 타이머가 정리된다', async () => {
  const t = setup();
  const from = 'e'.repeat(24);
  await evaluate(t, `handleSignal({from:'${from}',kind:'invite',body:{name:'hello.txt',size:3}})`);
  assert.equal(evaluate(t, 'state.incoming.from'), from);
  assert.equal(t.get('incoming').classList.contains('hidden'), false);
  assert.equal(evaluate(t, 'INVITE_RESPONSE_TIMEOUT_MS'), 30000);
  evaluate(t, 'clearIncoming()');
  assert.equal(evaluate(t, 'state.incoming'), null);
  assert.equal(t.get('incoming').classList.contains('hidden'), true);
});

test('손상된 SDP 메시지 하나가 실패해도 같은 폴링의 후속 신호를 처리한다', async () => {
  const t = setup({responses: {poll: {status: 200, body: {
    messages: [{from:'f'.repeat(24), kind:'broken', body:{}},
      {from:'f'.repeat(24), kind:'next', body:{}}],
  }}}});
  await evaluate(t, 'ensureSession()');
  t.context.handled = [];
  evaluate(t, `handleSignal = async (message) => {
    if (message.kind === 'broken') throw new Error('SDP rejected');
    handled.push(message.kind);
  }`);
  evaluate(t, 'pollWait = async () => { state.running = false; }');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual([...t.context.handled], ['next']);
  assert.equal(evaluate(t, 'state.session !== null'), true);
  assert.ok(t.get('notice-text').textContent.includes('SDP rejected'));
});

test('전송 중 SDP 협상 오류 발생 시 종료하고도 후속 메시지를 처리한다', async () => {
  const t = setup({responses: {poll: {status: 200, body: {
    messages: [{from:'f'.repeat(24), kind:'broken', body:{}},
      {from:'f'.repeat(24), kind:'next', body:{}}],
  }}}});
  await evaluate(t, 'ensureSession()');
  const active = {peerId:'f'.repeat(24), role:'sender', pc:null,channel:null,timeout:null};
  t.context.active = active;
  evaluate(t, 'state.active = active');
  t.context.handled = [];
  evaluate(t, `handleSignal = async (message) => {
    if (message.kind === 'broken') throw new Error('SDP rejected');
    handled.push(message.kind);
  }`);
  evaluate(t, 'pollWait = async () => { state.running = false; }');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual([...t.context.handled], ['next']);
  assert.equal(evaluate(t, 'state.active'), null);
  assert.match(t.get('notice-text').textContent, /SDP rejected/);
});

test('ACK 폴링은 응답 재전달에서도 신호를 중복 실행하지 않는다', async () => {
  const id = 'c'.repeat(24);
  const t = setup({responses: {poll: {status:200, body: {messages: [
    {id, from:'f'.repeat(24),kind:'candidate',body:{candidate:{candidate:'1'}}},
  ]}}}});
  await evaluate(t, 'ensureSession()');
  t.context.handled = [];
  evaluate(t, `handleSignal = async (message) => { handled.push(message.id); };
    pollWait = async () => { state.running = false; };`);
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual([...t.context.handled], [id]);
  assert.deepEqual([...t.requests.at(-1).data.acks], []);
  evaluate(t, 'state.running = true');
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual([...t.context.handled], [id]);
  assert.deepEqual([...t.requests.at(-1).data.acks], [id]);
});

test('처리 실패한 신호는 즉시 ACK하지 않고 재시도한 뒤 종료 처리한다', async () => {
  const first = 'a'.repeat(24), second = 'b'.repeat(24);
  const t = setup({responses: {poll: {status:200, body:{messages:[
    {id:first,from:'f'.repeat(24),kind:'failed',body:{}},
    {id:second,from:'f'.repeat(24),kind:'next',body:{}},
  ]}}}});
  await evaluate(t, 'ensureSession()');
  t.context.handled = [];
  evaluate(t, `handleSignal = async (msg) => {
    if (msg.kind === 'failed') throw Error('invalid SDP');
    handled.push(msg.kind);
  }; pollWait = async () => { state.running = false; };`);
  await evaluate(t, '__realLoop(state.loopId)');
  assert.deepEqual([...t.context.handled], ['next']);
  assert.deepEqual([...evaluate(t, 'pendingAcks')], [second], '실패한 메시지는 ACK 보류');
  for (let attempt = 2; attempt <= 3; attempt++) {
    evaluate(t, 'state.running = true');
    await evaluate(t, '__realLoop(state.loopId)');
  }
  assert.ok([...evaluate(t, 'pendingAcks')].includes(first), '3회 실패 후에만 종료 ACK');
  assert.deepEqual([...t.context.handled], ['next']);
  assert.equal(evaluate(t, 'failedSignals.size'), 0);
});

test('복제 탭은 기존 세션 토큰을 공유하지 않고 새 세션을 등록한다', async () => {
  const channelBus = [];
  const first = setup({channelBus});
  await evaluate(first, 'ensureSession()');
  const copied = first.sessionStorage.getItem('arcdrop-session');
  assert.equal(channelBus.length, 1);
  const second = setup({channelBus, tab: {'arcdrop-session': copied}});
  await evaluate(second, 'ensureSession()');
  assert.deepEqual(second.requests.map((item) => item.action), ['register', 'peers']);
  assert.equal(first.requests.filter((item) => item.action === 'register').length, 1);
});

test('전송 ID는 새 프로토콜 기기에만 사용하고 구형 기기에는 기존 흐름을 유지한다', async () => {
  const t = setup();
  await evaluate(t, 'ensureSession()');
  t.context.file = { name:'test.txt', size:1 };
  t.context.modern = { id:'m'.repeat(24), name:'Modern', protocolVersion:2 };
  t.context.legacy = { id:'l'.repeat(24), name:'Legacy' };
  await evaluate(t, 'beginInvite(modern, file)');
  assert.equal(t.requests.at(-1).data.transferId, 'aa'.repeat(12));
  evaluate(t, 'resetTransfer()');
  await evaluate(t, 'beginInvite(legacy, file)');
  assert.equal('transferId' in t.requests.at(-1).data, false);
  assert.equal(evaluate(t, 'state.active.transferId'), null);
  evaluate(t, 'resetTransfer()');
});

test('CGI API는 네트워크가 멈추면 AbortController로 시간을 제한한다', async () => {
  const t = setup();
  t.context.fetch = async (_url, config) => new Promise((_resolve, reject) => {
    config.signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  await assert.rejects(evaluate(t, "api('poll', {}, 5)"), /시간이 초과/);
});

test('이전 전송의 취소와 거절 신호는 새 전송을 종료하지 않는다', async () => {
  const t = setup();
  const from = 'f'.repeat(24);
  evaluate(t, `state.active = {peerId:'${from}',transferId:'2'.repeat(24),role:'sender',
    phase:'awaiting-approval',channel:null,pc:null,timeout:null};`);
  await evaluate(t, `handleSignal({from:'${from}',kind:'bye',transferId:'1'.repeat(24),body:{}})`);
  assert.equal(evaluate(t, 'state.active.peerId'), from);
  await evaluate(t, `handleSignal({from:'${from}',kind:'decline',transferId:'1'.repeat(24),body:{}})`);
  assert.equal(evaluate(t, 'state.active.peerId'), from);
  await evaluate(t, `handleSignal({from:'${from}',kind:'decline',transferId:'2'.repeat(24),body:{}})`);
  assert.equal(evaluate(t, 'state.active'), null);
});

test('신호 요청 ID는 보안 난수로 생성하고 요청 재전송에서 동일 ID를 유지한다', async () => {
  const t = setup();
  t.context.crypto = {getRandomValues(bytes) { bytes.fill(0xab); return bytes; }};
  const id = evaluate(t, 'newSignalId()');
  assert.equal(id, 'ab'.repeat(12));
  await evaluate(t, 'ensureSession()');
  evaluate(t, `state.session = {id:'a'.repeat(24), token:'b'.repeat(48)};`);
  // Verify the actual CGI signal request uses the cryptographic key.
  await evaluate(t, `signal('f'.repeat(24), 'invite', {name:'a.txt',size:1})`);
  assert.equal(t.requests.at(-1).data.requestId, id);
});

test('503 응답 시 동일한 시그널링 요청 ID로만 재시도하고 권한 오류는 재시도하지 않는다', async () => {
  const t = setup();
  await evaluate(t, 'ensureSession()');
  t.context.crypto = {getRandomValues(bytes) { bytes.fill(0xcd); return bytes; }};
  const sent = [];
  t.context.fetch = async (url, config) => {
    sent.push(JSON.parse(config.body));
    return {ok: sent.length > 1, status: sent.length > 1 ? 200 : 503,
      json: async () => sent.length > 1 ? {} : {error: 'temporary unavailable'}};
  };
  await evaluate(t, "signal('f'.repeat(24), 'invite', {name:'a.txt',size:1})");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].requestId, 'cd'.repeat(12));
  assert.deepEqual(sent[0], sent[1], '재시도는 최초 요청 본문과 ID를 그대로 사용');

  let denied = 0;
  t.context.fetch = async () => {
    denied++;
    return {ok:false,status:403,json:async()=>({error:'forbidden'})};
  };
  await assert.rejects(evaluate(t, "signal('f'.repeat(24),'offer',{sdp:{type:'offer',sdp:'v=0'}})"),
    /forbidden/);
  assert.equal(denied, 1, '권한 오류를 재시도하면 안 됨');
});

test('승인 전 취소 알림은 오래된 수신 모달을 닫는다', async () => {
  const t = setup();
  const from = 'e'.repeat(24);
  await evaluate(t, `handleSignal({from:'${from}',kind:'invite',body:{name:'test.txt',size:2}})`);
  assert.equal(t.get('incoming').classList.contains('hidden'), false);
  await evaluate(t, `handleSignal({from:'${from}',kind:'bye',body:{}})`);
  assert.equal(evaluate(t, 'state.incoming'), null);
  assert.equal(t.get('incoming').classList.contains('hidden'), true);
  assert.match(t.get('notice-text').textContent, /취소/);
});
