import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const js = readFileSync(resolve(root, 'web/app.js'), 'utf8');
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
  assert.deepEqual(readdirSync(resolve(root, 'web')).sort(), ['app.js', 'demo.html', 'demo.js', 'icon.svg', 'index.html', 'style.css']);
  const mk = readFileSync(resolve(root, 'Makefile'), 'utf8');
  assert.doesNotMatch(mk, /web\/demo(?:\.html|\.js)/);
});
