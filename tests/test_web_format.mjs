// SPDX-License-Identifier: GPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compactCss } from '../tools/css_fixture.mjs';

const root = resolve(import.meta.dirname, '..');
const css = readFileSync(resolve(root, 'web/style.css'), 'utf8');
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const demo = readFileSync(resolve(root, 'web/demo.html'), 'utf8');

function documentTags(markup) {
  return [...markup.matchAll(/<(\/)?([a-zA-Z][\w-]*)(?:\s[^<>]*?)?\/?\s*>/g)]
    .map((match) => [Boolean(match[1]), match[2].toLowerCase()]);
}

test('CSS는 한 줄에 여러 규칙을 압축하지 않고 선택자와 선언을 읽기 쉽게 유지한다', () => {
  const lines = css.split('\n');
  assert.ok(lines.length > 400, '복잡한 CSS를 한 줄로 압축하지 않아야 합니다');
  assert.ok(Math.max(...lines.map((line) => line.length)) <= 160);
  for (const line of lines) {
    if (line.trim().startsWith('@')) continue;
    if (line.trim().endsWith('{')) {
      assert.doesNotMatch(line, /:\s+[a-z][\w-]*\s*\{/,
        '가상 선택자 앞에 공백을 넣어 선택자 의미를 바꾸면 안 됩니다');
    }
  }
  assert.match(css, /--wave-start-scale:\s*\.1395/);
  assert.match(css, /--wave-start-scale:\s*\.177/);
  assert.match(css, /\.top\s*\{[^}]*height:\s*84px/s);
  assert.doesNotMatch(css, /\.top\s*\{[^}]*border-bottom:/s);
  assert.match(compactCss(css), /@media\(prefers-reduced-motion:reduce\)\{\.sonar-wave\{animation:none/);
});

test('HTML 정리는 태그 순서, SVG 파형, 로컬 자산 정책을 유지한다', () => {
  for (const markup of [html, demo]) {
    assert.ok(markup.split('\n').length > 90);
    assert.match(markup, /^<!doctype html>\n<html lang="ko">/);
    assert.equal((markup.match(/class="sonar-wave wave-[1-5]"/g) || []).length, 5);
    const ids = [...markup.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, new Set(ids).size, '중복 HTML id는 없어야 합니다');
    assert.doesNotMatch(markup, /\bon(?:click|load|error)\s*=/i);
    assert.doesNotMatch(markup, /<script[^>]+src="https?:/i);
    assert.deepEqual(documentTags(markup).filter((item) => item[1] === 'html'),
      [[false, 'html'], [true, 'html']]);
  }
  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.doesNotMatch(html, /demo\.js|DESIGN PREVIEW/);
  assert.match(demo, /<script src="\.\/demo\.js" defer><\/script>/);
});
