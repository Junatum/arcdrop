// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { Sha256 } from '../web/js/sha256.js';
import { browserTestSource } from '../tools/browser_vm.mjs';
import { compactCss } from '../tools/css_fixture.mjs';
const root = resolve(import.meta.dirname, '..');
const read = (name) => readFileSync(resolve(root, name), 'utf8');
const app = browserTestSource(root);
const css = compactCss(read('web/style.css'));
const html = read('web/index.html').replace(/>\s+</g, '><');
const demo = read('web/demo.html').replace(/>\s+</g, '><');
const demoJs = read('web/demo.js');
const iconSvg = read('web/icon.svg');

test('중앙 기기에서 5개의 파동이 더 넓게 확산되고 모션 감소 설정을 존중한다', () => {
  assert.match(html, /class="self-node"/);
  assert.deepEqual([...html.matchAll(/class="sonar-wave wave-(\d)"/g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5]);
  assert.match(css, /@keyframes sonar/);
  assert.match(css, /scale\(var\(--wave-start-scale\)\)/);
  assert.match(css, /scale\(1\.18\)/);
  assert.match(css, /animation:sonar 7s linear infinite/);
  assert.match(css, /--wave-peak-opacity:\.52/);
  assert.match(css, /:root\[data-theme=\"light\"\]\{[^}]*--wave-peak-opacity:\.39/);
  assert.match(css, /\.discovery\{--radar-center-y:45%;--self-orb-size:88px;--wave-size:760px;--wave-start-scale:\.1395/);
  assert.match(css, /\.sonar-wave\{width:var\(--wave-size\);height:var\(--wave-size\)/);
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
  assert.match(css, /\.top\{[^}]*height:84px;[^}]*z-index:2\}/);
  assert.match(css, /@media\(max-width:700px\)\{[^\n]*\.top\{padding-inline:17px;height:84px\}/);
  assert.doesNotMatch(css, /\.top\{[^}]*border-bottom:/, '헤더 구분선은 없어야 함');
  assert.match(css, /\.demo-toolbar\{[^}]*border-bottom:1px solid var\(--line\)/, '데모 툴바의 구분선은 유지');
  assert.match(css, /\.demo-toolbar\{width:100%;/);
  assert.match(css, /main\{width:100%;max-width:1120px;margin-inline:auto;padding-inline:30px/);
  assert.doesNotMatch(css, /\.shell\{max-width:1120px/);
});
test('중앙 파동과 실제 내 기기 아이콘의 중심은 데스크톱·모바일·다수 기기에서 같다', () => {
  assert.match(css, /\.discovery\{--radar-center-y:45%;--self-orb-size:88px;--wave-size:760px;--wave-start-scale:\.1395/);
  assert.match(css, /\.sonar-wave\{[^}]*top:var\(--radar-center-y\)/);
  assert.match(css, /\.self-node\{[^}]*top:var\(--radar-center-y\);transform:translate\(-50%,calc\(var\(--self-orb-size\) \/ -2\)\)/);
  assert.match(css, /\.self-orb\{width:var\(--self-orb-size\);height:var\(--self-orb-size\)/);
  assert.match(css, /\.discovery\[data-density="many"\]\{min-height:620px;--radar-center-y:32%\}/);
  assert.doesNotMatch(css, /\.discovery\[data-density="many"\] \.radar\{bottom:180px\}/);
  assert.match(css, /@media\(max-width:700px\)\{[^\n]*--radar-center-y:29%;--self-orb-size:74px;--wave-size:520px;--wave-start-scale:\.177/);
  assert.doesNotMatch(css, /\.radar::after|--radar-mask-size/);
  assert.match(css, /@keyframes sonar\{0%\{transform:translate\(-50%,-50%\) scale\(var\(--wave-start-scale\)\);opacity:var\(--wave-start-opacity\)\}/);
});

// The starting border must touch the visible self-device halo, not a masked
// ring that only becomes visible when it has already moved away from the orb.
test('5개 파동은 중앙 기기 외곽선에서 시작하며 데스크톱과 모바일의 시작 반경이 일치한다', () => {
  const desktop = {orb: 88, wave: 760, start: .1395};
  const mobile = {orb: 74, wave: 520, start: .177};
  for (const size of [desktop, mobile]) {
    const firstRingRadius = size.wave * size.start / 2;
    const outsideOrbHalo = size.orb / 2 + 9;
    assert.ok(Math.abs(firstRingRadius - outsideOrbHalo) < .15,
      `파동 시작 반경 ${firstRingRadius}와 기기 외곽 ${outsideOrbHalo}가 일치해야 함`);
  }
  assert.doesNotMatch(css, /\.radar::after|--radar-mask-size/,
    '중앙 마스크 때문에 최초 파동이 기기와 떨어져 보이면 안 됨');
  assert.match(css, /opacity:var\(--wave-start-opacity\)/,
    '파동 시작 지점부터 보이도록 초기 투명도를 설정해야 함');
  for (const markup of [html, demo]) {
    assert.equal((markup.match(/class="sonar-wave wave-[1-5]"/g) || []).length, 5);
  }
  assert.deepEqual([...css.matchAll(/\.wave-([2-5])\{animation-delay:-([\d.]+)s\}/g)].map(m => [Number(m[1]), Number(m[2])]),
    [[2, 1.4], [3, 2.8], [4, 4.2], [5, 5.6]]);
  assert.match(css, /--wave-tail-opacity:\.17/);
  assert.match(css, /--wave-tail-opacity:\.10/);
  assert.match(css, /94%\{opacity:var\(--wave-tail-opacity\)\}/);
  // Five rings are phase-shifted by 20% of the animation cycle. None of the
  // foreground snapshots should collapse to only three perceptible rings.
  const stops = [[0, .18], [12, .39], [72, .23], [94, .10], [100, 0]];
  const opacity = (phase) => {
    for (let i = 1; i < stops.length; i++) {
      if (phase <= stops[i][0]) {
        const [start, a] = stops[i - 1];
        const [end, b] = stops[i];
        return a + (b - a) * (phase - start) / (end - start);
      }
    }
    return 0;
  };
  for (let frame = 0; frame < 100; frame += 5) {
    const visible = [0, 20, 40, 60, 80]
      .filter(offset => opacity((frame + offset) % 100) >= .09).length;
    assert.ok(visible >= 4, `${frame}% 시점에서 파동 ${visible}개만 보임`);
  }
});

test('테마 전환 버튼은 라이트 모드에서도 선명한 아이콘과 전용 버튼 스타일을 유지한다', () => {
  for (const markup of [html, demo]) {
    assert.match(markup, /<symbol id="icon-moon" viewBox="0 0 24 24"><path d="M14\.5 3\.5a8\.5 8\.5 0 1 0 6 14\.5 7\.5 7\.5 0 1 1-6-14\.5Z"\/>/);
    assert.match(markup, /id="theme-toggle" class="icon-button theme-toggle"/);
  }
  assert.match(css, /\.theme-toggle\{border-color:var\(--line\);background:color-mix/);
  assert.match(css, /\.theme-toggle \.icon\{width:20px;height:20px/);
});

// Firefox and WebKit may briefly rasterize the rectangular inset-shadow layer
// of a scaled CSS circle as a + shaped seam. SVG circle strokes have no such
// rectangular shadow layer; preserve the five phase offsets and edge origin.
test('파동의 사각형 그림자 레이어를 제거하고 순수 SVG 원형 선으로 그린다', () => {
  for (const markup of [html, demo]) {
    const waves = [...markup.matchAll(/<svg class="sonar-wave wave-(\d)" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><circle cx="50" cy="50" r="49" vector-effect="non-scaling-stroke"\/><\/svg>/g)];
    assert.deepEqual(waves.map((w) => Number(w[1])), [1, 2, 3, 4, 5], '모든 파동은 SVG 원형 벡터 선이어야 함');
    assert.doesNotMatch(markup, /<div class="sonar-wave/);
  }
  const rule = css.match(/\.sonar-wave\{([^}]*)\}/)?.[1];
  assert.ok(rule, '파동 CSS가 있어야 함');
  assert.doesNotMatch(rule, /(?:box-shadow|border|border-radius|filter)\s*:/,
    '사각형 요소의 inset 그림자 또는 둥근 모서리 레이어가 다시 생성되면 안 됨');
  assert.match(css, /\.sonar-wave circle\{fill:none;stroke:var\(--wave-ring\);stroke-width:1\.8\}/);
  assert.doesNotMatch(css, /--wave-glow|\.radar::after|--radar-mask-size/);
  assert.match(css, /animation:sonar 7s linear infinite/);
  const expected = { desktop: { size: 760, scale: .1395, orb: 88 }, mobile: { size: 520, scale: .177, orb: 74 } };
  for (const [screen, {size, scale, orb}] of Object.entries(expected)) {
    // r=49 of viewBox=100, plus half of the 1.8px non-scaling stroke.
    const start = size * scale * .49 + .9;
    const outerEdge = orb / 2 + 9;
    assert.ok(Math.abs(start - outerEdge) < 1, `${screen}: 첫 원형 파동이 기기 후광 외곽에서 시작`);
  }
});

test('고정 레이더 원은 없애고 중앙에서 확산되는 파동만 표시한다', () => {
  for (const markup of [html, demo]) {
    assert.doesNotMatch(markup, /radar-ring|ring-[123]/);
    assert.equal((markup.match(/class="sonar-wave wave-[1-5]"/g) || []).length, 5);
  }
  assert.doesNotMatch(css, /\.radar-ring|\.ring-[123]\s*\{/);
  assert.match(css, /\.sonar-wave\{[^}]*animation:sonar 7s linear infinite/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.sonar-wave\{animation:none;opacity:0\}/);
  assert.doesNotMatch(css, /radar-ring|ring-[123]/);
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
  assert.match(html, /script type="module" src="\.\/app\.js"/);
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
    setTimeout, clearTimeout, navigator: {}, console, TextEncoder, Blob, AbortController,
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
  const intervals = new Map();
  const revoked = [];
  let intervalId = 0;
  const sandbox = {
    document: { getElementById: get, createElement: () => new Element(),
      createElementNS: () => new Element(), querySelector: () => null, addEventListener: () => {},
      documentElement: { dataset: {} }, body: { classList: new Classes() } },
    window: { isSecureContext: false, addEventListener: () => {}, prompt: () => null },
    location: { protocol: 'http:' }, localStorage: { getItem: () => null, setItem: () => {} },
    fetch: async () => { throw Error('unexpected HTTP request'); },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    setInterval: (fn) => { const id = ++intervalId; intervals.set(id, fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    navigator: navigatorValue, console, TextEncoder, Blob,
    URL: { createObjectURL: () => 'blob:arcdrop-test', revokeObjectURL: (url) => revoked.push(url) },
    RTCPeerConnection: class {
      connectionState = 'connected';
      close() { this.connectionState = 'closed'; }
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(app, context, { filename: 'app.js' });
  return { context, get, timers, intervals, revoked };
}

test('파일 저장 버튼을 누른 뒤에만 5초 카운트다운을 진행하고 안내창을 닫는다', () => {
  for (const markup of [html, demo]) {
    assert.match(markup, /id="download-hint"/);
    assert.match(markup, /id="download-countdown" class="dialog-footnote hidden" role="status" aria-live="polite">다운로드를 요청했습니다\. <span id="download-countdown-value" class="download-countdown-seconds">5초<\/span> 후 자동으로 닫힙니다\.<\/p>/);
  }
  const { context, get, intervals, revoked } = createBrowserRuntime();
  context.fakeNow = 100000;
  vm.runInContext('Date.now = () => fakeNow; state.blobUrl = "blob:arcdrop-test"; show("download", true)', context);
  assert.equal(intervals.size, 0, '파일 수신만으로 타이머 시작 금지');
  assert.equal(get('download-countdown').classList.contains('hidden'), true);
  assert.equal(get('download').classList.contains('hidden'), false);

  get('download-link').click();
  assert.equal(intervals.size, 1);
  assert.equal(get('download-countdown-value').textContent, '5초');
  assert.equal(get('download-countdown').classList.contains('hidden'), false);
  assert.equal(get('download-link').textContent, '다시 저장');
  assert.equal(revoked.length, 0, '다운로드 요청 직후 Blob 해제 금지');
  const tick = () => { for (const run of [...intervals.values()]) run(); };
  context.fakeNow += 1100; tick();
  assert.equal(get('download-countdown-value').textContent, '4초');
  context.fakeNow += 3800; tick();
  assert.equal(get('download-countdown-value').textContent, '1초');
  assert.equal(get('download').classList.contains('hidden'), false);
  assert.equal(revoked.length, 0);
  context.fakeNow += 100; tick();
  assert.equal(get('download').classList.contains('hidden'), true);
  assert.equal(intervals.size, 0);
  assert.deepEqual(revoked, ['blob:arcdrop-test']);
  assert.equal(get('download-link').textContent, '파일 저장');
  assert.equal(get('download-countdown').classList.contains('hidden'), true);
  assert.equal(get('download-hint').classList.contains('hidden'), false);
});

test('재저장은 카운트다운을 다시 시작하고 수동 닫기·새 전송은 잔여 타이머를 정리한다', () => {
  const { context, get, intervals, revoked } = createBrowserRuntime();
  context.fakeNow = 200000;
  vm.runInContext('Date.now = () => fakeNow; state.blobUrl = "blob:first"; show("download", true)', context);
  get('download-link').click();
  const originalTimer = [...intervals.keys()][0];
  context.fakeNow += 4000;
  get('download-link').click();
  assert.equal(intervals.has(originalTimer), false);
  assert.equal(intervals.size, 1);
  for (const run of intervals.values()) run();
  assert.equal(get('download-countdown-value').textContent, '5초');
  context.fakeNow += 1200;
  for (const run of intervals.values()) run();
  assert.equal(get('download-countdown-value').textContent, '4초');
  get('done').click();
  assert.equal(intervals.size, 0);
  assert.equal(get('download').classList.contains('hidden'), true);
  assert.deepEqual(revoked, ['blob:first']);
  vm.runInContext('state.blobUrl = "blob:second"; show("download", true)', context);
  get('download-link').click();
  vm.runInContext('cleanDownload()', context);
  assert.equal(intervals.size, 0, '새 전송 전 정리 후 타이머가 남지 않아야 함');
  assert.deepEqual(revoked, ['blob:first', 'blob:second']);
});

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
      offer:{name:'sample.txt',size:3},started:true,phase:'receiving',bytes:3,
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
      pc:null,channel:testChannel,candidates:[],finished:false,phase:'awaiting-ack',bytes:3,file:{size:3}};
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
    state.active = { peerId: 'mac', role: 'receiver', phase:'awaiting-offer', candidates: [
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


test('데모도 실제 주변 기기의 전송·자리 비움 상태를 표시하지만 운영 패키지에는 포함하지 않는다', () => {
  assert.match(demo, /data-demo="presence"/);
  assert.match(demoJs, /const PRESENCE_PEERS =/);
  assert.match(demoJs, /status: 'busy'/);
  assert.match(demoJs, /status: 'away'/);
  assert.match(demoJs, /btn\.disabled = status !== 'available'/);
  assert.match(app, /entry\.btn\.disabled = discoveryBusy\(\) \|\| status !== 'available'/);
  assert.match(css, /\.peer\[data-presence="away"\]/);
  const makefile = read('Makefile');
  assert.doesNotMatch(makefile, /INSTALL_DATA[^\n]*demo(?:\.js|\.html)/);
});


test('주변 기기가 없어도 중복 안내 문구 없이 탐지 상태만 표시한다', () => {
  for (const markup of [html, demo]) {
    assert.doesNotMatch(markup, /다른 기기에서 ArcDrop을 열면 이곳에 나타납니다\./);
    assert.doesNotMatch(markup, /id="empty-hint"/);
    assert.match(markup, /id="peer-count"[^>]*aria-live="polite"/);
  }
  assert.doesNotMatch(css, /\.empty-hint|\[data-empty=/);
  assert.doesNotMatch(app, /dataset\.empty/);
  assert.doesNotMatch(demoJs, /dataset\.empty/);
});

test('SDP 협상 실패는 이전 단계를 복원하여 재전달된 신호를 다시 처리할 수 있다', async () => {
  for (const [role, phase, kind] of [
    ['sender', 'awaiting-approval', 'accept'],
    ['receiver', 'awaiting-offer', 'offer'],
  ]) {
    const {context} = createBrowserRuntime();
    const id = '1'.repeat(24);
    context.testMessage = {from:'peer',transferId:id,kind,body:kind === 'offer'
      ? {sdp:{type:'offer',sdp:'v=0'}} : {}};
    context.testTransferId = id;
    vm.runInContext(`state.active = {
      peerId:'peer', transferId:testTransferId, role:'${role}',phase:'${phase}',
      pc:null,channel:null,received:[],parts:[],candidates:[],timeout:null,finished:false
    }`, context);
    await assert.rejects(vm.runInContext('handleSignal(testMessage)', context));
    assert.equal(vm.runInContext('state.active.phase', context), phase);
    assert.equal(vm.runInContext('state.active.pc', context), null);
  }
});

test('전송 상태를 확인해 조기 ACK와 잘못된 청크를 거부한다', () => {
  const { context } = createBrowserRuntime();
  context.testChannel = { readyState:'open',send() {},close() {} };
  vm.runInContext(`state.active = {
    peerId:'sender',role:'sender',phase:'sending',bytes:3,file:{size:3},
    channel:testChannel,received:[],parts:[],candidates:[]
  }`, context);
  assert.throws(() => vm.runInContext("receiveMessage(state.active, JSON.stringify({type:'ack'}))", context),
    /예상하지 못한/);
  assert.equal(vm.runInContext('state.active.finished', context), undefined);
  vm.runInContext(`state.active = {
    peerId:'receiver',role:'receiver',phase:'receiving',started:true,bytes:0,
    offer:{name:'a.txt',size:20000},channel:testChannel,
    received:[],parts:[],candidates:[]
  }`, context);
  assert.throws(() => vm.runInContext('receiveMessage(state.active, new ArrayBuffer(16385))', context),
    /잘못된 파일 데이터/);
});

test('수신 메모리는 1MiB씩 Blob 구간으로 묶고 원본 데이터 순서를 보존한다', async () => {
  const { context } = createBrowserRuntime();
  const buffers = [];
  context.capture = buffers;
  context.URL = {createObjectURL(blob) { buffers.push(blob); return 'blob:segments'; }, revokeObjectURL() {}};
  context.testChannel = { readyState:'open', send() {}, close() {} };
  vm.runInContext(`state.active = {
    peerId:'mac',peerName:'Mac',role:'receiver',phase:'receiving',started:true,
    bytes:0,offer:{name:'large.bin',size:1048579},channel:testChannel,
    received:[],parts:[],candidates:[],timeout:null
  };`, context);
  vm.runInContext(`for(let i=0;i<64;i++) {
    const chunk = new Uint8Array(16384);chunk.fill(i);receiveMessage(state.active,chunk.buffer);
  }`, context);
  assert.equal(vm.runInContext('state.active.parts.length', context), 1);
  assert.equal(vm.runInContext('state.active.received.length', context), 0);
  vm.runInContext(`receiveMessage(state.active,new Uint8Array([7,8,9]).buffer);
    receiveMessage(state.active,JSON.stringify({type:'end'}));`, context);
  assert.equal(buffers.length, 1);
  assert.equal(buffers[0].size, 1048579);
  const bytes = new Uint8Array(await buffers[0].arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0, 0, 0]);
  assert.deepEqual([...bytes.slice(63*16384, 63*16384+3)], [63, 63, 63]);
  assert.deepEqual([...bytes.slice(-3)], [7, 8, 9]);
  assert.equal(vm.runInContext('state.active.parts.length', context), 0);
});

test('SHA-256 일치 시에만 다운로드를 보여주고 손상되면 전송을 거부한다', async () => {
  for (const mismatch of [false, true]) {
    const { context, get } = createBrowserRuntime();
    const payload = Uint8Array.from([65, 66, 67]);
    const expected = createHash('sha256').update(payload).digest('hex');
    context.crypto = webcrypto;
    const sent = [];
    let created = 0;
    context.URL = {
      createObjectURL() { created++; return 'blob:sha-test'; },
      revokeObjectURL() {},
    };
    context.testChannel = { readyState:'open', send(text) { sent.push(JSON.parse(text)); }, close() {} };
    vm.runInContext(`state.active = {
      peerId:'peer',peerName:'peer',role:'receiver',phase:'receiving',started:true,bytes:3,
      offer:{name:'test.bin',size:3},channel:testChannel,received:[new Uint8Array([65,66,67]).buffer],
      parts:[],candidates:[],timeout:null
    }`, context);
    context.expectedHash = mismatch ? '0'.repeat(64) : expected;
    vm.runInContext(`receiveMessage(state.active, JSON.stringify({type:'end',sha256:expectedHash}))`, context);
    assert.equal(get('download').classList.contains('hidden'), true, '검증 중 다운로드 금지');
    for (let n=0; n<30; n++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (mismatch ? vm.runInContext('state.active === null', context) : created === 1) break;
    }
    assert.equal(created, mismatch ? 0 : 1);
    assert.equal(sent.some(m => m.type === 'ack'), !mismatch, '검증 실패 후 ACK 금지');
    if (mismatch) assert.match(get('notice-text').textContent, /무결성 검사/);
    else assert.equal(get('download').classList.contains('hidden'), false);
  }
});

test('소형 파일은 기존 WebCrypto 경로를 유지하고 대용량 전체 읽기는 피한다', async () => {
  const { context } = createBrowserRuntime();
  context.crypto = webcrypto;
  context.testFile = new Blob([Uint8Array.from([65, 66, 67])]);
  context.testFile.name = 'abc.txt';
  const sent = [];
  context.testChannel = {readyState:'open',bufferedAmount:0,send(v) {
    if (typeof v === 'string') sent.push(JSON.parse(v));
  },close() {}};
  vm.runInContext(`state.active = {
    file:testFile,peerId:'peer',peerName:'peer',role:'sender',channel:testChannel,
    bytes:0,received:[],parts:[],candidates:[],timeout:null
  }`, context);
  await vm.runInContext('sendFile(state.active)', context);
  assert.equal(sent.at(-1).sha256, createHash('sha256').update('ABC').digest('hex'));
  context.big = {size:9*1024*1024,arrayBuffer() {throw Error('unexpected full read');}};
  assert.equal(await vm.runInContext('smallFileDigest(big)', context), null);
});

test('전송 진행률은 100ms마다 갱신하며 완료 상태는 즉시 표시한다', () => {
  const { context, get } = createBrowserRuntime();
  let now = 1000;
  context.Date = {now:() => now};
  context.transfer = {lastUiAt:undefined};
  vm.runInContext(`transferProgress(transfer,'진행',100,1000,'상세')`, context);
  assert.equal(get('transfer-percent').textContent, '10%');
  now += 30;
  vm.runInContext(`transferProgress(transfer,'진행',500,1000,'상세')`, context);
  assert.equal(get('transfer-percent').textContent, '10%');
  now += 70;
  vm.runInContext(`transferProgress(transfer,'진행',600,1000,'상세')`, context);
  assert.equal(get('transfer-percent').textContent, '60%');
  vm.runInContext(`transferProgress(transfer,'완료',1000,1000,'완료',true)`, context);
  assert.equal(get('transfer-percent').textContent, '100%');
});

test('활발한 청크 전송 중에는 매 청크마다 새 타이머를 생성하지 않는다', () => {
  const { context, timers } = createBrowserRuntime();
  vm.runInContext(`state.active = {deadline:0,timeout:null};
    for(let i=0;i<4096;i++) armTimeout(state.active);`, context);
  assert.equal(timers.length, 1);
});

test('사용자 안내와 기기 이름은 밝은·어두운 테마와 모바일에서 충분히 읽힌다', () => {
  // Verify theme-specific high-contrast text tokens rather than relying on
  // the small, low-contrast secondary text originally used for core actions.
  assert.match(css, /:root\{[^}]*--readable-muted:#d0dbee;--guide-ink:#b7c8ff;/);
  assert.match(css, /:root\[data-theme="light"\]\{[^}]*--readable-muted:#455974;--guide-ink:#2448c9;/);
  const styles = (selector) => [...css.matchAll(new RegExp(`\\.${selector}\\{([^}]*)\\}`, 'g'))]
    .map((match) => match[1]);
  const has = (selector, expression) => styles(selector).some((style) => expression.test(style));
  assert.ok(has('self-identity', /font-size:17px;color:var\(--ink\)/));
  assert.ok(has('peer-name', /font-size:15px;font-weight:700/));
  assert.ok(has('peer-action', /font-size:13px;font-weight:650;color:var\(--guide-ink\)/));
  assert.ok(has('peer-count', /font-size:16px;[^}]*color:var\(--guide-ink\)/));
  assert.ok(has('privacy-note', /font-size:14px;[^}]*color:var\(--readable-muted\)/) ||
    has('privacy-note', /color:var\(--readable-muted\);font-size:14px/));
  assert.ok(has('dialog-description', /font-size:15px;[^}]*color:var\(--readable-muted\)/));
  assert.ok(has('download-countdown-seconds', /color:var\(--accent\)/));
  assert.match(css, /#download-countdown\{font-size:17px\}/, '자동 닫힘 안내만 17px로 확대');
  assert.doesNotMatch(css, /\.download-countdown\{display:flex|\.download-countdown-value\{font-size:/);
  assert.ok(has('connection-status', /font-size:13px;font-weight:650/));
  // Mobile overrides must not make essential labels 10 px or hide the status text.
  assert.ok(has('peer-name', /font-size:14px/));
  assert.ok(has('peer-action', /font-size:12px/));
  assert.ok(has('privacy-note', /font-size:13px/));
  assert.ok(has('connection-status', /font-size:12px/));
  assert.ok(has('connection-status', /font-size:11px/));
  assert.doesNotMatch(css, /\.connection-status\{font-size:0(?:px)?;/);
  for (const markup of [html, demo]) {
    assert.match(markup, /class="privacy-note"/);
    assert.match(markup, /id="peer-count" class="peer-count"/);
    assert.match(markup, /id="connection-label"/);
  }
});

test('증분 SHA-256은 표준 벡터와 8/64 MiB 경계에서 Node.js 결과와 일치한다', () => {
  const vectors = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ];
  for (const [value, expected] of vectors) {
    const hash = new Sha256();
    hash.update(new TextEncoder().encode(value));
    assert.equal(hash.digestHex(), expected);
    assert.throws(() => hash.digestHex(), /완료/);
  }
  const chunk = new Uint8Array(16 * 1024);
  for (let i = 0; i < chunk.length; i++) chunk[i] = (i * 53 + 13) & 255;
  for (const length of [55, 56, 63, 64, 65, 8 * 1024 * 1024 + 1, 64 * 1024 * 1024]) {
    const actual = new Sha256();
    const reference = createHash('sha256');
    for (let offset = 0; offset < length; offset += chunk.length) {
      const slice = chunk.subarray(0, Math.min(chunk.length, length - offset));
      actual.update(slice); reference.update(slice);
    }
    assert.equal(actual.digestHex(), reference.digest('hex'), `${length} byte SHA-256`);
  }
});

test('9 MiB 이상 전송은 전체 파일 읽기 없이 SHA-256을 포함하며 수신 후 검증한다', async () => {
  const size = 9 * 1024 * 1024 + 7;
  const payload = new Uint8Array(size);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + (i >>> 9)) & 255;
  const expected = createHash('sha256').update(payload).digest('hex');
  const source = new Blob([payload]);
  source.name = 'large.bin';
  source.arrayBuffer = () => { throw Error('whole-file allocation forbidden'); };

  const sender = createBrowserRuntime();
  const packets = [];
  sender.context.testFile = source;
  sender.context.testChannel = {readyState: 'open', bufferedAmount: 0, send(data) { packets.push(data); }, close() {}};
  vm.runInContext(`state.active = {
    file:testFile,peerId:'receiver',peerName:'receiver',role:'sender',channel:testChannel,
    bytes:0,received:[],parts:[],candidates:[],timeout:null
  }`, sender.context);
  await vm.runInContext('sendFile(state.active)', sender.context);
  const meta = JSON.parse(packets[0]);
  const end = JSON.parse(packets.at(-1));
  assert.equal(meta.integrity, 'sha256');
  assert.equal(end.sha256, expected);
  assert.equal(packets.filter(p => p instanceof ArrayBuffer).length, Math.ceil(size / (16 * 1024)));

  for (const corrupt of [false, true]) {
    const receiver = createBrowserRuntime();
    const sent = [];
    let downloads = 0;
    // Large receive must not invoke Blob.arrayBuffer(), which copies the file.
    receiver.context.Blob = class extends Blob {
      arrayBuffer() { throw Error('whole-file verification allocation forbidden'); }
    };
    receiver.context.URL = {createObjectURL() { downloads++; return 'blob:verified'; }, revokeObjectURL() {}};
    receiver.context.testChannel = {readyState: 'open', send(data) { sent.push(JSON.parse(data)); }, close() {}};
    receiver.context.meta = JSON.stringify(meta);
    receiver.context.end = JSON.stringify(end);
    vm.runInContext(`state.active = {
      peerId:'sender',peerName:'sender',role:'receiver',phase:'receiving',started:false,
      bytes:0,offer:{name:'large.bin',size:${size}},channel:testChannel,
      received:[],parts:[],candidates:[],timeout:null
    }; receiveMessage(state.active,meta);`, receiver.context);
    for (const [i, packet] of packets.slice(1, -1).entries()) {
      const bytes = corrupt && i === 17 ? new Uint8Array(packet).slice() : packet;
      if (corrupt && i === 17) bytes[0] ^= 1;
      receiver.context.packetBytes = new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes);
      vm.runInContext('receiveMessage(state.active,new Uint8Array(packetBytes).buffer)', receiver.context);
    }
    if (corrupt) assert.throws(() => vm.runInContext('receiveMessage(state.active,end)', receiver.context),
      /무결성 검사/);
    else vm.runInContext('receiveMessage(state.active,end)', receiver.context);
    assert.equal(downloads, corrupt ? 0 : 1);
    assert.equal(sent.filter(m => m.type === 'ack').length, corrupt ? 0 : 1);
  }
});

test('새 발신자의 SHA-256 누락은 거부하고 오래된 프로토콜은 유지한다', () => {
  for (const integrity of [true, false]) {
    const receiver = createBrowserRuntime();
    let downloads = 0;
    receiver.context.URL = {createObjectURL() { downloads++; return 'blob:test'; }, revokeObjectURL() {}};
    receiver.context.testChannel = {send() {}, close() {}};
    receiver.context.meta = JSON.stringify({type:'meta', name:'test.bin', size:1,
      ...(integrity ? {integrity:'sha256'} : {})});
    vm.runInContext(`state.active = {
      peerId:'old',peerName:'old',role:'receiver',phase:'receiving',started:false,bytes:0,
      offer:{name:'test.bin',size:1},channel:testChannel,received:[],parts:[],timeout:null
    }; receiveMessage(state.active,meta); receiveMessage(state.active,new Uint8Array([42]).buffer);`, receiver.context);
    if (integrity) assert.throws(() => vm.runInContext(
      "receiveMessage(state.active,JSON.stringify({type:'end'}))", receiver.context), /무결성 검증값/);
    else vm.runInContext("receiveMessage(state.active,JSON.stringify({type:'end'}))", receiver.context);
    assert.equal(downloads, integrity ? 0 : 1);
  }
});
