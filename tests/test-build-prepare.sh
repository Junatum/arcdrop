#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
source = (root / 'Makefile').read_text(encoding='utf-8')


def require(ok, message):
    if not ok:
        raise SystemExit(f'FAIL: {message}')


# Reuse the host json-c discovery used by the CGI and browser E2E tests.
# OpenWrt provides TARGET_CFLAGS/TARGET_LDFLAGS itself; this fixture does not.
sys.path.insert(0, str(root / 'tests'))
from test_cgi import json_c_build_flags  # noqa: E402


def host_target_flags(flags):
    """Split native json-c discovery into compile and link Make variables."""
    cflags, ldflags = [], []
    iterator = iter(flags)
    for flag in iterator:
        if flag in ('-I', '-isystem', '-iquote', '-D', '-U'):
            cflags.extend((flag, next(iterator)))
        elif flag.startswith(('-I', '-isystem', '-iquote', '-D', '-U')):
            cflags.append(flag)
        elif flag == '-pthread':
            cflags.append(flag)
            ldflags.append(flag)
        elif flag != '-ljson-c':  # The actual package recipe already links it.
            ldflags.append(flag)
    return cflags, ldflags


# Simulate Homebrew's non-system include/library paths so the test cannot
# regress into silently dropping native compiler/linker flags on macOS.
mac_cflags, mac_ldflags = host_target_flags([
    '-I/opt/homebrew/opt/json-c/include',
    '-L/opt/homebrew/opt/json-c/lib',
    '-Wl,-rpath,/opt/homebrew/opt/json-c/lib', '-ljson-c',
])
require(mac_cflags == ['-I/opt/homebrew/opt/json-c/include'] and
        mac_ldflags == ['-L/opt/homebrew/opt/json-c/lib',
                        '-Wl,-rpath,/opt/homebrew/opt/json-c/lib'],
        'macOS Homebrew json-c 컴파일/링크 옵션 분리가 잘못되었습니다')
try:
    host_cflags, host_ldflags = host_target_flags(json_c_build_flags())
except RuntimeError as exc:
    raise SystemExit(f'FAIL: 호스트 Build/Compile의 {exc}') from exc


def target_variables(cflags, ldflags):
    # Quote each token for Make's recipe shell, not for subprocess.run().
    return [f'TARGET_CFLAGS={shlex.join(cflags)}',
            f'TARGET_LDFLAGS={shlex.join(ldflags)}']


require('define Build/Prepare\n\tmkdir -p $(PKG_BUILD_DIR)' in source,
        '빌드 준비 시 정의되지 않은 MKDIR 대신 mkdir -p를 사용해야 합니다')
require('$(MKDIR)' not in source,
        'OpenWrt에서 보장되지 않는 MKDIR 변수를 사용하지 않아야 합니다')
make = shutil.which('make') or shutil.which('gmake')
require(make is not None, 'GNU Make가 필요합니다')
with tempfile.TemporaryDirectory(prefix='arc-prepare-') as d:
    fixture = Path(d)
    # The real package Makefile is parsed, but full OpenWrt is not needed.
    (fixture / 'rules.mk').write_text('BUILD_DIR := $(TOPDIR)/output\nCP := cp -f\n'
                                      'TARGET_CC := cc\n',
                                      encoding='utf-8')
    (fixture / 'package.mk').write_text('BuildPackage =\n', encoding='utf-8')
    runner = fixture / 'prepare.mk'
    runner.write_text('.PHONY: test-prepare test-compile\n'
                      'test-prepare:\n\t$(Build/Prepare)\n'
                      'test-compile:\n\t$(Build/Compile)\n',
                      encoding='utf-8')

    def make_command(recipe: Path, dest: Path, target: str, *, cflags=None, ldflags=None):
        return [make, '--no-print-directory', '-f', str(recipe), '-f', str(runner),
                f'TOPDIR={fixture}', f'INCLUDE_DIR={fixture}', f'BUILD_DIR={dest}',
                *target_variables(host_cflags if cflags is None else cflags,
                                  host_ldflags if ldflags is None else ldflags),
                target]

    def run_recipe(recipe: Path, dest: Path):
        return subprocess.run(
            make_command(recipe, dest, 'test-prepare'),
            cwd=root, capture_output=True, text=True, check=False,
        )

    build = fixture / 'build'
    result = run_recipe(root / 'Makefile', build)
    require(result.returncode == 0,
            '실제 Makefile Build/Prepare 실패: ' + result.stdout + result.stderr)
    prepared = build / 'smartsafehub-app-arcdrop-0.1.0'
    for item in [*sorted(p.name for p in (root / 'src').glob('*.c')), 'arcdrop.h', 'LICENSE']:
        expected = root / ('LICENSE' if item == 'LICENSE' else 'src/' + item)
        created = prepared / item
        require(created.is_file() and created.read_bytes() == expected.read_bytes(),
                f'{item} 소스 파일 복사가 누락되거나 변경되었습니다')

    # Compile with the actual OpenWrt Build/Compile recipe, not a separately
    # assembled host command. Missing module objects must fail this check.
    # run_recipe invokes test-prepare, so exercise the compile target explicitly.
    # Verify the *real* Makefile uses forwarded native flags even if json-c
    # happens to be in standard system paths on the current CI host.
    dry_run = subprocess.run(
        make_command(root / 'Makefile', build, 'test-compile',
                     cflags=mac_cflags, ldflags=mac_ldflags) + ['-n'],
        cwd=root, capture_output=True, text=True, check=False,
    )
    require(dry_run.returncode == 0 and
            all(flag in dry_run.stdout for flag in mac_cflags + mac_ldflags),
            'OpenWrt Build/Compile이 호스트 json-c 경로 옵션을 전달하지 않습니다: '
            + dry_run.stdout + dry_run.stderr)

    compile_result = subprocess.run(
        make_command(root / 'Makefile', build, 'test-compile'),
        cwd=root, capture_output=True, text=True, check=False,
    )
    require(compile_result.returncode == 0,
            '실제 Makefile Build/Compile 실패: ' + compile_result.stdout + compile_result.stderr)
    require((prepared / 'arcdrop').is_file(), 'CGI 최종 바이너리 생성 누락')

    # Regression check: the pre-fix recipe must fail under the same fixture.
    broken = fixture / 'broken.mk'
    broken.write_text(source.replace('\tmkdir -p $(PKG_BUILD_DIR)',
                                     '\t$(MKDIR) $(PKG_BUILD_DIR)', 1),
                      encoding='utf-8')
    failed = run_recipe(broken, fixture / 'broken-output')
    require(failed.returncode != 0,
            '회귀 검증 실패: 잘못된 MKDIR 명령을 테스트가 탐지하지 못했습니다')

print('PASS: OpenWrt Build/Prepare + Build/Compile, 모듈/라이선스 복사 및 MKDIR 회귀 검증')
PYTEST
