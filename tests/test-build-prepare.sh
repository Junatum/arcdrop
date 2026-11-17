#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
source = (root / 'Makefile').read_text(encoding='utf-8')


def require(ok, message):
    if not ok:
        raise SystemExit(f'FAIL: {message}')


require('define Build/Prepare\n\tmkdir -p $(PKG_BUILD_DIR)' in source,
        '빌드 준비 시 정의되지 않은 MKDIR 대신 mkdir -p를 사용해야 합니다')
require('$(MKDIR)' not in source,
        'OpenWrt에서 보장되지 않는 MKDIR 변수를 사용하지 않아야 합니다')
make = shutil.which('make') or shutil.which('gmake')
require(make is not None, 'GNU Make가 필요합니다')
with tempfile.TemporaryDirectory(prefix='arc-prepare-') as d:
    fixture = Path(d)
    # The real package Makefile is parsed, but full OpenWrt is not needed.
    (fixture / 'rules.mk').write_text('BUILD_DIR := $(TOPDIR)/output\nCP := cp -f\n',
                                      encoding='utf-8')
    (fixture / 'package.mk').write_text('BuildPackage =\n', encoding='utf-8')
    runner = fixture / 'prepare.mk'
    runner.write_text('.PHONY: test-prepare\ntest-prepare:\n\t$(Build/Prepare)\n',
                      encoding='utf-8')

    def run_recipe(recipe: Path, dest: Path):
        return subprocess.run(
            [make, '--no-print-directory', '-f', str(recipe), '-f', str(runner),
             f'TOPDIR={fixture}', f'INCLUDE_DIR={fixture}', f'BUILD_DIR={dest}',
             'test-prepare'],
            cwd=root, capture_output=True, text=True, check=False,
        )

    build = fixture / 'build'
    result = run_recipe(root / 'Makefile', build)
    require(result.returncode == 0,
            '실제 Makefile Build/Prepare 실패: ' + result.stdout + result.stderr)
    prepared = build / 'smartsafehub-app-arcdrop-0.1.0'
    for item, expected in (('arcdrop.c', root / 'src/arcdrop.c'),
                           ('LICENSE', root / 'LICENSE')):
        created = prepared / item
        require(created.is_file() and created.read_bytes() == expected.read_bytes(),
                f'{item} 소스 파일 복사가 누락되거나 변경되었습니다')

    # Regression check: the pre-fix recipe must fail under the same fixture.
    broken = fixture / 'broken.mk'
    broken.write_text(source.replace('\tmkdir -p $(PKG_BUILD_DIR)',
                                     '\t$(MKDIR) $(PKG_BUILD_DIR)', 1),
                      encoding='utf-8')
    failed = run_recipe(broken, fixture / 'broken-output')
    require(failed.returncode != 0,
            '회귀 검증 실패: 잘못된 MKDIR 명령을 테스트가 탐지하지 못했습니다')

print('PASS: OpenWrt Build/Prepare 실제 실행, 소스/라이선스 복사 및 MKDIR 회귀 검증')
PYTEST
