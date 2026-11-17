import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { browserTestSource, moduleNames } from '../tools/browser_vm.mjs';
const root = resolve(import.meta.dirname, '..');
const js = browserTestSource(root);
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');

test('파일 전송은 WebRTC 직접 연결만 사용한다', () => {
  assert.match(js, /new RTCPeerConnection\(rtcConfig\)/);
  assert.match(js, /iceServers:\s*\[\]/);
  assert.match(js, /channel\.send\(bytes\)/);
  assert.doesNotMatch(js, /fetch\([^\n]*file\.slice|FormData|uploadFile/);
});
test('대용량 파일과 채널 버퍼를 제한한다', () => {
  assert.match(js, /LIMIT = 64 \* 1024 \* 1024/);
  assert.match(js, /CHUNK = 16 \* 1024/);
  assert.match(js, /channel\.bufferedAmount > 1024 \* 1024/);
});
test('브라우저는 HTTPS와 수신 승인을 요구한다', () => {
  assert.match(js, /location\.protocol !== 'https:'/);
  assert.match(js, /if \(kind === 'invite'\)/);
  assert.match(js, /'accept'/);
  assert.match(html, /id="accept"/);
  assert.match(html, /id="decline"/);
});
test('UI는 로컬 정적 소스만 쓰고 외부 스크립트가 없다', () => {
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /<(?:script|link|img)[^>]*(?:src|href)=['"]https?:\/\//i);
  assert.deepEqual(readdirSync(resolve(root, 'web')).sort(), ['app.js', 'demo.html', 'demo.js', 'icon.svg', 'index.html', 'js', 'style.css']);
  const mk = readFileSync(resolve(root, 'Makefile'), 'utf8');
  assert.doesNotMatch(mk, /web\/demo(?:\.html|\.js)/);
});


test('운영 클라이언트는 번들러 없이 ES 모듈을 로드하고 데모를 설치하지 않는다', () => {
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /unsafe-inline|https?:\/\/[^"']+\.js/i);
  const mk = readFileSync(resolve(root, 'Makefile'), 'utf8');
  const match = mk.match(/^ARCDROP_WEB_MODULES:=(.*)$/m);
  assert.ok(match, 'OpenWrt package must enumerate the browser modules');
  assert.deepEqual(match[1].trim().split(/\s+/).sort(), moduleNames.map((name) => `${name}.js`).sort());
  assert.match(mk, /\$\(INSTALL_DATA\) \$\(addprefix \.\/web\/js\/,\$\(ARCDROP_WEB_MODULES\)\) \$\(1\)\/www\/arcdrop\/js\//);
  for (const moduleName of moduleNames) {
    const source = readFileSync(resolve(root, 'web/js', `${moduleName}.js`), 'utf8');
    assert.match(source, /SPDX-License-Identifier: GPL-3\.0-or-later/);
    assert.doesNotMatch(source, /https?:\/\/[^\s'"`]+\.js|fetch\([^\n]*file\.slice|FormData/);
  }
  assert.match(readFileSync(resolve(root, 'web/js/signaling.js'), 'utf8'), /iceServers:\s*\[\]/);
  assert.doesNotMatch(mk, /INSTALL_DATA[^\n]*demo/);
});

test('브라우저 모듈은 외부 의존성이나 순환 import 없이 로딩된다', () => {
  const graph = new Map();
  for (const name of moduleNames) {
    const code = readFileSync(resolve(root, `web/js/${name}.js`), 'utf8');
    const imports = [...code.matchAll(/^import \{[^\n]+\} from '\.(?:\/)([^']+)';$/gm)]
      .map((match) => match[1]);
    assert.ok(imports.every((item) => moduleNames.includes(item.replace(/\.js$/, ''))),
      `${name}.js must import local browser modules only`);
    graph.set(`${name}.js`, imports);
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    assert.ok(!visiting.has(name), `Circular module import: ${name}`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const next of graph.get(name)) visit(next);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of graph.keys()) visit(name);
});

test('실제 ES 모듈의 import/export 그래프와 초기화가 브라우저 모의 환경에서 성공한다', () => {
  // Run a separate Node VM that links the real modules as ESM, not the
  // unit-test classic-script projection. This also catches missing exports.
  const code = `
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const root = process.cwd();
const element = () => ({ addEventListener() {}, classList: { toggle() {} }, dataset: {}, textContent: '' });
const context = vm.createContext({
  document: { getElementById: element, querySelector: () => null, documentElement: {dataset:{}},
    body: {classList:{toggle(){}}}, addEventListener(){} },
  window: { isSecureContext: false, addEventListener(){} },
  location: {protocol:'http:'},
  setTimeout, clearTimeout, console, TextEncoder, Blob, navigator:{},
});
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename);
  const source = fs.readFileSync(filename, 'utf8');
  const mod = new vm.SourceTextModule(source, { context, identifier: filename });
  cache.set(filename, mod);
  return mod;
}
const entry = load(path.join(root, 'web/app.js'));
await entry.link((specifier, ref) => {
  if (!specifier.startsWith('./')) throw Error('External module dependency: ' + specifier);
  const target = path.resolve(path.dirname(ref.identifier), specifier);
  if (!target.startsWith(path.join(root, 'web/js') + path.sep))
    throw Error('Unexpected module import path: ' + target);
  return load(target);
});
await entry.evaluate();
if (cache.size !== 8) throw Error('Module graph size: ' + cache.size);
const state = [...cache.values()].find((mod) => mod.identifier.endsWith('/core.js')).namespace.state;
if (state.active !== null || state.session !== null) throw Error('Unexpected transfer state');
`;
  const result = spawnSync(process.execPath, ['--no-warnings', '--experimental-vm-modules',
    '--input-type=module', '-e', code], {cwd: root, encoding: 'utf8'});
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
