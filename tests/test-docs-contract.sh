#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
from urllib.parse import unquote
import re
import sys

root = Path(sys.argv[1])
required = (
    'README.md', 'README.ko.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md',
    'docs/DEVELOPMENT.md', 'docs/ko/DEVELOPMENT.md', 'docs/DEPLOYMENT.md',
    'docs/INSTALLATION.md', 'docs/ARCHITECTURE.md',
)

def require(ok, message):
    if not ok:
        raise SystemExit(f'FAIL: {message}')

for item in required:
    require((root / item).is_file(), f'필수 문서 누락: {item}')

eng = (root / 'README.md').read_text(encoding='utf-8')
kor = (root / 'README.ko.md').read_text(encoding='utf-8')
dev = (root / 'docs/DEVELOPMENT.md').read_text(encoding='utf-8')
dev_ko = (root / 'docs/ko/DEVELOPMENT.md').read_text(encoding='utf-8')
mk = (root / 'Makefile').read_text(encoding='utf-8')
version = re.search(r'^PKG_VERSION:=(\S+)$', mk, re.M)
release = re.search(r'^PKG_RELEASE:=(\d+)$', mk, re.M)
require(bool(version and release), '패키지 버전 확인 불가')
full = f'{version.group(1)}-r{release.group(1)}'
for path, text in (('README.md', eng), ('README.ko.md', kor),
                   ('docs/DEVELOPMENT.md', dev), ('docs/ko/DEVELOPMENT.md', dev_ko)):
    require(full in text, f'버전 동기화 오류: {path}')

require('[한국어](README.ko.md)' in eng, '영어 README 한국어 링크 누락')
require('[English](README.md)' in kor, '한국어 README 영어 링크 누락')
require('[한국어](ko/DEVELOPMENT.md)' in dev, '영어 개발 가이드 한국어 링크 누락')
require('[English](../DEVELOPMENT.md)' in dev_ko, '한국어 개발 가이드 영어 링크 누락')
require(len(re.findall('[가-힣]', kor)) >= 100 and len(re.findall('[가-힣]', dev_ko)) >= 100,
        '한국어 문서 내용이 부족합니다')
require(len(re.findall('[가-힣]', dev)) <= 5,
        '영어 기본 개발 가이드에 한국어 본문이 포함되었습니다')
require('http://127.0.0.1:8080/demo.html' in dev and
        'http://127.0.0.1:8080/demo.html' in dev_ko,
        '실제 디자인 데모 실행 안내 누락')
require('excluded from the router package' in dev and 'demo.html' not in mk,
        '디자인 데모 배포 분리 안내 누락')
require('64 MiB' in dev and 'WebRTC' in dev and 'HTTPS' in dev,
        '개발 가이드의 핵심 기술 제약 누락')

# Validate every local Markdown hyperlink in the documents we ship.
# External links and fragment-only anchors need no file lookup.
links = re.compile(r'(?<!!)\[[^\]]*\]\(([^)]+)\)')
for item in required:
    file = root / item
    content = file.read_text(encoding='utf-8')
    for raw in links.findall(content):
        url = raw.split(' ', 1)[0].strip('<>')
        if not url or url.startswith(('#', 'https://', 'http://', 'mailto:')):
            continue
        local = unquote(url.split('#', 1)[0])
        require(bool(local), f'{item}: 빈 로컬 링크')
        target = (file.parent / local).resolve()
        require(target.is_relative_to(root.resolve()) and target.is_file(),
                f'{item}: 끊어진 링크: {url}')

changelog = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
require(changelog.startswith('# Changelog\n'), '영어 CHANGELOG 제목')
require(f'## {full} (' in changelog, '최신 CHANGELOG 버전')
require('### Improved' in changelog and '### Tests' in changelog,
        '영어 CHANGELOG 분류 누락')
require(not re.search(r'^### (?:추가|개선|수정|테스트|호환성)\s*$', changelog, re.M),
        'CHANGELOG의 과거 한국어 분류가 남았습니다')
require('one blank line' in (root / 'CONTRIBUTING.md').read_text(encoding='utf-8'),
        '기여 가이드 공백 규칙 누락')
print('PASS: ArcDrop 영어/한국어 문서, 링크, 버전, 데모 및 CHANGELOG 문서 계약')
PYTEST
