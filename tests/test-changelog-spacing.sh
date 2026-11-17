#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
text = (root / 'CHANGELOG.md').read_text(encoding='utf-8')
lines = text.splitlines()
versions = [(i, m.group(1)) for i, line in enumerate(lines)
            if (m := re.fullmatch(r'## (\d+\.\d+\.\d+-r\d+) \(\d{4}-\d{2}-\d{2}\)', line))]
if not versions:
    raise SystemExit('FAIL: CHANGELOG 릴리스가 없습니다')
mk = (root / 'Makefile').read_text(encoding='utf-8')
version = re.search(r'^PKG_VERSION:=(\S+)$', mk, re.M)
release = re.search(r'^PKG_RELEASE:=(\d+)$', mk, re.M)
if not version or not release or versions[0][1] != f'{version.group(1)}-r{release.group(1)}':
    raise SystemExit('FAIL: CHANGELOG 최신 버전이 Makefile과 다릅니다')
if len(set(v for _, v in versions)) != len(versions):
    raise SystemExit('FAIL: CHANGELOG 릴리스 버전이 중복되었습니다')
for i, _ in versions[1:]:
    prev = i - 1
    while prev >= 0 and not lines[prev].strip():
        if lines[prev]:
            raise SystemExit('FAIL: 릴리스 사이에 공백 문자만 있는 줄이 있습니다')
        prev -= 1
    if i - prev - 1 != 2:
        raise SystemExit(f'FAIL: {i + 1}행 릴리스 전에 빈 줄 두 개가 필요합니다')
print(f'PASS: ArcDrop CHANGELOG {len(versions)}개 릴리스 버전과 빈 줄 두 개씩이 있습니다')
PYTEST
