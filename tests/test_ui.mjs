// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const app = read('web/app.js');
const css = read('web/style.css');
const html = read('web/index.html');
const demo = read('web/demo.html');
const demoJs = read('web/demo.js');
const iconSvg = read('web/icon.svg');

test('중앙 기기에서 5개의 파동이 더 넓게 확산되고 모션 감소 설정을 존중한다', () => {
  assert.match(html, /class="self-node"/);
  assert.deepEqual([...html.matchAll(/class="sonar-wave wave-(\d)"/g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5]);
  assert.match(css, /@keyframes sonar/);
  assert.match(css, /scale\(\.1\)/);
  assert.match(css, /scale\(1\.18\)/);
  assert.match(css, /animation:sonar 7s linear infinite/);
  assert.match(css, /\.sonar-wave\{width:760px;height:760px/);
  assert.match(css, /\.sonar-wave\{width:520px;height:520px\}/);
  for (const [wave, delay] of [[2, 1.4], [3, 2.8], [4, 4.2], [5, 5.6]]) {
    assert.ok(css.includes(`.wave-${wave}{animation-delay:-${delay}s}`));
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.sonar-wave\{animation:none/);
});

// Layout regression: animated-wave origins must coincide with the
// visual center of the blue self-device orb, not the whole labeled self node.
test('헤더는 전체 화면 너비를 사용하고 콘텐츠는 가운데에 제한한다', () => {
  assert.match(css, /\.shell\{width:100%;min-height:100svh/);
  assert.match(css, /\.top\{width:100%;padding-inline:clamp\(20px,3vw,48px\)/);
  assert.match(css, /\.demo-toolbar\{width:100%;/);
  assert.match(css, /main\{width:100%;max-width:1120px;margin-inline:auto;padding-inline:30px/);
  assert.doesNotMatch(css, /\.shell\{max-width:1120px/);
});
test('중앙 파동과 실제 내 기기 아이콘의 중심은 데스크톱·모바일·다수 기기에서 같다', () => {
  assert.match(css, /\.discovery\{--radar-center-y:45%;--self-orb-size:88px/);
  assert.match(css, /\.sonar-wave\{[^}]*top:var\(--radar-center-y\)/);
  assert.match(css, /\.self-node\{[^}]*top:var\(--radar-center-y\);transform:translate\(-50%,calc\(var\(--self-orb-size\) \/ -2\)\)/);
  assert.match(css, /\.self-orb\{width:var\(--self-orb-size\);height:var\(--self-orb-size\)/);
  assert.match(css, /\.discovery\[data-density="many"\]\{min-height:620px;--radar-center-y:32%\}/);
  assert.doesNotMatch(css, /\.discovery\[data-density="many"\] \.radar\{bottom:180px\}/);
  assert.match(css, /@media\(max-width:700px\)\{[^\n]*--radar-center-y:29%;--self-orb-size:74px/);
});

test('고정 레이더 원은 없애고 중앙에서 확산되는 파동만 표시한다', () => {
  for (const markup of [html, demo]) {
    assert.doesNotMatch(markup, /radar-ring|ring-[123]/);
    assert.equal((markup.match(/class="sonar-wave wave-[1-5]"/g) || []).length, 5);
  }
  assert.doesNotMatch(css, /\.radar-ring|\.ring-[123]\s*\{/);
  assert.match(css, /\.sonar-wave\{[^}]*animation:sonar 7s linear infinite/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.sonar-wave\{animation:none;opacity:0\}/);
});


test('무한대형 로고와 전송 흐름은 이음매 없이 같은 SVG 곡선을 공유한다', () => {
  assert.match(iconSvg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 256 256"/);
  assert.match(iconSvg, /<rect width="256" height="256" rx="59"/);
  assert.match(iconSvg, /<linearGradient id="flow"/);
  const main = iconSvg.match(/<path d="([^"]+)"\s+fill="none" stroke="url\(#ribbon\)"/)?.[1];
  const accent = iconSvg.match(/<path d="([^"]+)"\s+fill="none" stroke="url\(#flow\)"/)?.[1];
  assert.ok(main && accent, '기본 무한대 곡선과 청록색 전송 흐름이 모두 존재해야 함');
  const shared = 'C113 151 125 127 140 109 C153 93 168 88 182 93';
  assert.ok(main.includes(shared) && accent.includes(shared), '전송 흐름은 기본 곡선의 동일한 베지어 제어점을 사용해야 함');
  assert.match(iconSvg, /stop-opacity="0"/);
  assert.doesNotMatch(iconSvg, /<script|<foreignObject|onload=|href=|https?:\/\/[^\s"]+\.(?:js|css)/i);
  assert.doesNotMatch(iconSvg, /m12 12 3 3-3 3-3-3Z|M4\.25 17\.5/);
});

test('운영·데모·탭 아이콘과 전송 팝업이 공통 자체 SVG 파일을 사용한다', () => {
  for (const markup of [html, demo]) {
    assert.match(markup, /<link rel="icon" type="image\/svg\+xml" href="\.\/icon\.svg">/);
    assert.match(markup, /<div class="brand-icon" aria-hidden="true"><img src="\.\/icon\.svg" alt=""/);
    assert.match(markup, /<div class="dialog-symbol sending"><img src="\.\/icon\.svg" alt=""/);
    assert.doesNotMatch(markup, /id="icon-arcdrop"|href="#icon-arcdrop"/);
  }
  assert.match(css, /\.brand-icon img\{display:block;width:100%;height:100%\}/);
  assert.match(css, /\.dialog-symbol\.sending img\{display:block;width:44px;height:44px/);
  const makefile = read('Makefile');
  assert.match(makefile, /\$\(INSTALL_DATA\) \.\/web\/icon\.svg \$\(1\)\/www\/arcdrop\/icon\.svg/);
  assert.doesNotMatch(makefile, /INSTALL_DATA[^\n]*demo/);
});

test('모바일에서 주변 기기를 2열로 배치하고 접근 가능한 모달을 제공한다', () => {
  assert.match(css, /@media\(max-width:700px\)/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  for (const id of ['incoming','transfer','download','help-dialog']) {
    assert.match(html, new RegExp(`id="${id}" class="dialog-backdrop hidden" role="dialog" aria-modal="true"`));
  }
  assert.match(html, /aria-valuenow="0"/);
  assert.match(app, /setAttribute\('aria-valuenow'/);
});
test('브라우저 E2E도 기기 선택 후 파일을 고르는 새 흐름을 따른다', () => {
  const e2e = read('e2e/browser_e2e.py');
  assert.match(e2e, /expect_file_chooser\(\)/);
  assert.match(e2e, /locator\('\.peer'\)/);
  assert.doesNotMatch(e2e, /locator\('\.device'\)/);
});
test('디자인 데모는 실제 프로덕션 런타임 및 API와 격리된다', () => {
  assert.match(html, /script src="\.\/app\.js" defer/);
  assert.doesNotMatch(html, /demo\.js|DESIGN PREVIEW/);
  assert.match(demo, /script src="\.\/demo\.js" defer/);
  assert.doesNotMatch(demo, /script src="\.\/app\.js"/);
  assert.match(demo, /실제 전송 없음/);
  assert.doesNotMatch(demoJs, /fetch\s*\(|new RTCPeerConnection|sendBeacon|XMLHttpRequest/);
  assert.match(app, /location\.protocol !== 'https:'/);
  assert.match(app, /iceServers:\s*\[\]/);
  const makefile = read('Makefile');
  assert.doesNotMatch(makefile, /INSTALL_DATA[^\n]*demo/);
});

// A dependency-free DOM harness checks the actual file-picker flow without a
// browser, CGI, network, npm package, or relaxing production HTTPS checks.
class Classes {
  constructor() { this.values = new Set(['hidden']); }
  toggle(name, force) {
    if (force === undefined ? !this.values.has(name) : force) this.values.add(name);
    else this.values.delete(name);
  }
  remove(name) { this.values.delete(name); }
  add(name) { this.values.add(name); }
  contains(name) { return this.values.has(name); }
}
class Element {
  constructor() {
    this.children = []; this.listeners = new Map(); this.classList = new Classes();
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    this.dataset = {}; this.textContent = ''; this.value = '';
    this.lastChild = { textContent: '' }; this.attributes = {}; this.disabled = false;
  }
  addEventListener(name, listener) { this.listeners.set(name, listener); }
  emit(name, payload = {}) { this.listeners.get(name)?.(payload); }
  append(...els) { this.children.push(...els); }
  replaceChildren(...els) { this.children = [...els]; }
  setAttribute(key, value) { this.attributes[key] = value; }
  click() { this.clicked = true; this.emit('click'); }
  focus() { this.focused = true; }
}
test('주변 기기 클릭이 파일 선택으로 이어지고 파일 선택 후에만 초대한다', async () => {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const requests = [];
  const sandbox = {
    document: { getElementById: get, createElement: () => new Element(),
      createElementNS: () => new Element(), querySelector: () => null, addEventListener: () => {},
      documentElement: { dataset: {} }, body: { classList: new Classes() } },
    window: { isSecureContext: false, addEventListener: () => {}, prompt: () => null },
    location: { protocol: 'http:' }, localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({}) };
    },
    setTimeout, clearTimeout, navigator: {}, console, TextEncoder, Blob,
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(app, context, { filename: 'app.js' });
  vm.runInContext("state.peers = [{ id: 'peer-01', name: 'iPhone' }]; state.session = { id: 'me', token: 'token' }; renderPeers()", context);
  assert.equal(get('devices').children.length, 1);
  const target = get('devices').children[0];
  target.click();
  assert.equal(get('file-input').clicked, true);
  assert.equal(requests.length, 0, '선택창을 열었을 때는 초대를 보내지 않음');
  const file = { name: 'hello.txt', size: 5 };
  get('file-input').emit('change', { target: { files: [file] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /action=signal/);
  assert.equal(requests[0].body.to, 'peer-01');
  assert.equal(requests[0].body.kind, 'invite');
  assert.equal(requests[0].body.body.name, 'hello.txt');
  assert.equal(get('transfer').classList.contains('hidden'), false);
  vm.runInContext('resetTransfer()', context);
});

// Strict CSP must remain intact: no unsafe-inline and no runtime style attrs.
test('엄격한 CSP를 유지하며 인라인 스타일 없이 전송 진행률과 기기 배치를 렌더링한다', () => {
  for (const markup of [html, demo]) {
    assert.match(markup, /style-src 'self'/);
    assert.doesNotMatch(markup, /unsafe-inline|style=/i);
    assert.match(markup, /<progress[^>]*id="transfer-progress"[^>]*max="100" value="0"/);
    assert.doesNotMatch(markup, /id="progress-fill"/);
  }
  assert.match(css, /progress::-webkit-progress-value/);
  assert.match(css, /progress::-moz-progress-bar/);
  for (const code of [app, demoJs]) {
    assert.doesNotMatch(code, /\.style\.|setAttribute\(['"]style['"]|setProperty\(/);
    assert.match(code, /\('transfer-progress'\)\.value/);
    assert.match(code, /dataset\.rows/);
    assert.match(code, /peer-(?:pos|slot)-\$\{/);
  }
  for (const position of ['peer-pos-1-0','peer-pos-3-2','peer-pos-6-5'])
    assert.ok(css.includes(`.${position}{--peer-x:`), position);
  assert.match(css, /\.discovery\[data-rows="6"\]\{--list-height:840px\}/);
});

function createBrowserRuntime(navigatorValue = {}) {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const timers = [];
  const sandbox = {
    document: { getElementById: get, createElement: () => new Element(),
      createElementNS: () => new Element(), querySelector: () => null, addEventListener: () => {},
      documentElement: { dataset: {} }, body: { classList: new Classes() } },
    window: { isSecureContext: false, addEventListener: () => {}, prompt: () => null },
    location: { protocol: 'http:' }, localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => { throw Error('unexpected HTTP request'); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    navigator: navigatorValue, console, TextEncoder, Blob,
    URL: { createObjectURL: () => 'blob:arcdrop-test', revokeObjectURL: () => {} },
    RTCPeerConnection: class {
      connectionState = 'connected';
      close() { this.connectionState = 'closed'; }
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(app, context, { filename: 'app.js' });
  return { context, get, timers };
}

test('iPadOS가 Macintosh와 MacIntel로 표시되어도 태블릿으로 감지한다', () => {
  const cases = [
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/604.1', platform: 'MacIntel', maxTouchPoints: 5 }, 'iPad', 'tablet'],
    [{ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', platform: 'iPad', maxTouchPoints: 5 }, 'iPad', 'tablet'],
    [{ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', platform: 'MacIntel', maxTouchPoints: 0 }, 'Mac', 'desktop'],
    [{ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', platform: 'iPhone', maxTouchPoints: 5 }, 'iPhone', 'phone'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 15; Tablet)', platform: 'Linux armv8l', maxTouchPoints: 5 }, 'Android Tablet', 'tablet'],
    [{ userAgent: 'Mozilla/5.0 (Linux; Android 15; Mobile)', platform: 'Linux armv8l', maxTouchPoints: 5 }, 'Android Phone', 'phone'],
  ];
  for (const [nav, expectedName, expectedType] of cases) {
    const { context } = createBrowserRuntime(nav);
    const result = vm.runInContext('detectDevice()', context);
    assert.equal(result.name, expectedName, nav.userAgent);
    assert.equal(result.deviceType, expectedType, nav.userAgent);
  }
  const { context } = createBrowserRuntime();
  assert.equal(vm.runInContext("deviceIcon({name:'Mac',deviceType:'tablet'})", context), 'tablet');
  assert.equal(vm.runInContext("deviceIcon({name:'iPhone',deviceType:'laptop'})", context), 'laptop');
  assert.equal(vm.runInContext("deviceIcon({name:'iPad Pro'})", context), 'tablet');
  assert.equal(vm.runInContext("deviceIcon({name:'Custom'})", context), 'desktop');
});

test('수신 완료 후 상대방이 채널과 연결을 닫아도 오류 알림으로 변경하지 않는다', () => {
  const { context, get } = createBrowserRuntime();
  const sends = [];
  const channel = { readyState: 'open', send: (msg) => sends.push(JSON.parse(msg)), close() { this.readyState = 'closed'; } };
  context.testChannel = channel;
  vm.runInContext(`
    const t = {peerId:'peer-id',peerName:'Mac',role:'receiver',
      offer:{name:'sample.txt',size:3},started:true,bytes:3,
      received:[new Uint8Array([65,66,67]).buffer],candidates:[],channel:testChannel,finished:false};
    state.active = t;
    createConnection(t);
    installChannel(t, testChannel);
    receiveMessage(t, JSON.stringify({type:'end'}));
    testChannel.onerror();
    t.pc.connectionState = 'closed';
    t.pc.onconnectionstatechange();
  `, context);
  assert.equal(vm.runInContext('state.active.finished', context), true);
  assert.equal(get('download').classList.contains('hidden'), false);
  assert.equal(get('notice').classList.contains('hidden'), true);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].type, 'ack');
  assert.equal(get('download-link').href, 'blob:arcdrop-test');
});

test('송신 확인 ACK 이후 연결 종료도 오류 메시지를 발생시키지 않는다', () => {
  const { context, get } = createBrowserRuntime();
  const channel = { readyState: 'open', send() {}, close() { this.readyState = 'closed'; } };
  context.testChannel = channel;
  vm.runInContext(`
    const t = {peerId:'peer-id',peerName:'iPad',role:'sender',
      pc:null,channel:testChannel,candidates:[],finished:false};
    state.active=t;
    createConnection(t);
    installChannel(t,testChannel);
    receiveMessage(t, JSON.stringify({type:'ack'}));
    testChannel.onerror();
    t.pc.connectionState = 'closed';
    t.pc.onconnectionstatechange();
  `, context);
  assert.equal(vm.runInContext('state.active', context), null);
  assert.equal(get('notice').classList.contains('hidden'), true);
  assert.match(get('toast').textContent, /전송이 완료/);
});

// Reproduce Firefox/Gecko ↔ iPadOS/WebKit signaling without requiring a
// browser, network, or STUN server. The mock holds ICE gathering until the
// test explicitly releases it, so an early SDP send is detected.
class GatheringPeerConnection {
  static instances = [];
  constructor() {
    this.listeners = new Map(); this.iceGatheringState = 'new';
    this.signalingState = 'stable'; this.connectionState = 'new';
    this.localDescription = null; this.remoteDescription = null;
    this.addedCandidates = [];
    GatheringPeerConnection.instances.push(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  trigger(type) { for (const fn of this.listeners.get(type) || []) fn(); }
  createDataChannel() { return { readyState: 'connecting', close() {} }; }
  async createOffer() { return { type: 'offer', sdp: 'v=0\r\no=offer' }; }
  async createAnswer() { return { type: 'answer', sdp: 'v=0\r\no=answer' }; }
  async setLocalDescription(desc) {
    this.localDescription = {
      toJSON: () => ({ type: desc.type, sdp: `${desc.sdp}\r\na=candidate:1 1 udp 1 192.168.1.5 45678 typ host\r\n` }),
    };
    this.iceGatheringState = 'gathering';
  }
  async setRemoteDescription(desc) { this.remoteDescription = desc; }
  async addIceCandidate(candidate) {
    if (candidate.candidate === 'bad') throw new Error('mDNS lookup failed');
    this.addedCandidates.push(candidate.candidate);
  }
  completeIce() { this.iceGatheringState = 'complete'; this.trigger('icegatheringstatechange'); }
  close() { this.connectionState = 'closed'; this.signalingState = 'closed'; }
}
function gatheringRuntime() {
  GatheringPeerConnection.instances.length = 0;
  const runtime = createBrowserRuntime();
  const signals = [];
  const warnings = [];
  runtime.context.console = { warn: (message) => warnings.push(message) };
  runtime.context.RTCPeerConnection = GatheringPeerConnection;
  runtime.context.testSignals = signals;
  vm.runInContext('signal = async (to, kind, body) => { testSignals.push({to, kind, body}); }', runtime.context);
  return { ...runtime, signals, warnings };
}

test('Mac 송신 Offer는 로컬 ICE 수집 완료 후 후보를 포함해 한 번만 전달한다', async () => {
  const { context, signals } = gatheringRuntime();
  const promise = vm.runInContext(`(() => {
    const t = { peerId: 'ipad', role: 'sender', candidates: [], finished: false };
    state.active = t;
    return makeOffer(t);
  })()`, context);
  await new Promise((resolve) => setImmediate(resolve));
  const pc = GatheringPeerConnection.instances.at(-1);
  assert.equal(pc.iceGatheringState, 'gathering');
  assert.equal(signals.length, 0, 'ICE 완료 전 Offer를 보내지 않아야 함');
  pc.completeIce();
  await promise;
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, 'offer');
  assert.match(signals[0].body.sdp.sdp, /a=candidate:.*typ host/);
  assert.equal(signals.filter((s) => s.kind === 'candidate').length, 0);
});

test('iPad 수신 Answer는 ICE 완료 후 전송하고 실패한 구형 후보도 다른 후보를 막지 않는다', async () => {
  const { context, signals, warnings } = gatheringRuntime();
  const promise = vm.runInContext(`(() => {
    state.active = { peerId: 'mac', role: 'receiver', candidates: [
      {candidate: 'bad'}, {candidate: 'good'}
    ], finished: false };
    return handleSignal({from:'mac', kind:'offer', body:{
      sdp: {type:'offer', sdp:'v=0\\r\\na=candidate:old'}
    }});
  })()`, context);
  await new Promise((resolve) => setImmediate(resolve));
  const pc = GatheringPeerConnection.instances.at(-1);
  assert.deepEqual(pc.addedCandidates, ['good']);
  assert.equal(warnings.length, 1, '오래된 클라이언트의 잘못된 후보는 경고만 남김');
  assert.equal(signals.length, 0, 'ICE 완료 전 Answer를 보내지 않아야 함');
  pc.completeIce();
  await promise;
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, 'answer');
  assert.match(signals[0].body.sdp.sdp, /a=candidate:/);
  assert.equal(vm.runInContext('state.active.peerId', context), 'mac');
});

test('후보 수집 시간 초과 시 무한 대기하지 않고 이벤트 리스너를 정리한다', async () => {
  const { context, timers } = gatheringRuntime();
  const pc = new GatheringPeerConnection();
  context.testPc = pc;
  const promise = vm.runInContext('waitForIceGathering(testPc)', context);
  assert.equal(pc.listeners.get('icegatheringstatechange').size, 1);
  timers.at(-1)();
  await assert.rejects(promise, /ICE 후보 수집 시간이 초과/);
  assert.equal(pc.listeners.get('icegatheringstatechange').size, 0);
  assert.equal(pc.listeners.get('signalingstatechange').size, 0);
});

test('기존 CGI 후보 메시지의 오류가 다음 후보 처리를 중단하지 않는다', async () => {
  const { context, warnings } = gatheringRuntime();
  const pc = new GatheringPeerConnection();
  pc.remoteDescription = {type: 'offer', sdp:'v=0'};
  context.testPc = pc;
  await vm.runInContext(`(() => {
    state.active = { peerId:'remote', role:'receiver', pc:testPc, candidates: [] };
    return handleSignal({ from:'remote', kind:'candidate', body:{candidate:{candidate:'bad'}} });
  })()`, context);
  await vm.runInContext(`handleSignal({from:'remote',kind:'candidate',body:{candidate:{candidate:'good'}}})`, context);
  assert.deepEqual(pc.addedCandidates, ['good']);
  assert.equal(warnings.length, 1);
  assert.equal(vm.runInContext('state.active.peerId', context), 'remote');
});
