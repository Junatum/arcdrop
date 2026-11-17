#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Ensure each ArcDrop test is registered once in ShellSpec and run by CI.

Adapted to the attached Jarbis ShellSpec CI integrity pattern, with Node tests.
The checker performs mutation tests to catch accidental weakening of its gates.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEST_SUFFIXES = {'.sh', '.py', '.mjs'}
REGISTRATION = re.compile(
    r'^\s*When\s+run\s+command\s+(?:sh|python3|node --test --test-reporter=tap)\s+'
    r'["\']\$SHELLSPEC_PROJECT_ROOT/(tests/[\w./-]+\.(?:sh|py|mjs))["\']\s*$'
)
JOB_HEADER = re.compile(r'^  ([A-Za-z][A-Za-z0-9_-]*):\s*$')


class CoverageError(Exception):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise CoverageError(message)


def check_specs(root: Path) -> int:
    config = root / '.shellspec'
    require(config.is_file(), 'ShellSpec 설정 파일이 없습니다')
    content = config.read_text(encoding='utf-8')
    require('--shell sh' in content and '--format documentation' in content,
            'Jarbis와 동일한 ShellSpec 셸/출력 형식이 필요합니다')
    require(not (root / 'tests/run.sh').exists(), '이전 tests/run.sh가 남아 있습니다')
    test_dir = root / 'tests'
    scripts = {p.relative_to(root).as_posix() for p in test_dir.rglob('*')
               if p.is_file() and '__pycache__' not in p.parts
               and p.suffix in TEST_SUFFIXES}
    require(bool(scripts), '테스트 파일이 없습니다')
    unsupported = [p.relative_to(root).as_posix() for p in test_dir.rglob('*')
                   if p.is_file() and '__pycache__' not in p.parts
                   and (p.name.startswith(('test-', 'test_')) or
                        '.test.' in p.name or '.spec.' in p.name)
                   and p.suffix not in TEST_SUFFIXES]
    require(not unsupported, '지원되지 않는 테스트 확장자: ' + ', '.join(sorted(unsupported)))
    spec_dir = root / 'spec'
    specs = sorted(spec_dir.rglob('*_spec.sh'))
    require(bool(specs), 'ShellSpec 사양 파일이 없습니다')
    other_specs = sorted(p.relative_to(root).as_posix() for p in spec_dir.rglob('*.sh')
                         if p not in specs)
    require(not other_specs, 'ShellSpec 자동 검색 대상이 아닌 스크립트: ' + ', '.join(other_specs))

    registrations: Counter[str] = Counter()
    for path in specs:
        for line in path.read_text(encoding='utf-8').splitlines():
            if match := REGISTRATION.fullmatch(line):
                registrations[match.group(1)] += 1
    require(not (scripts - registrations.keys()),
            'ShellSpec 미등록 테스트: ' + ', '.join(sorted(scripts - registrations.keys())))
    require(not (registrations.keys() - scripts),
            '존재하지 않는 ShellSpec 테스트: ' + ', '.join(sorted(registrations.keys() - scripts)))
    duplicates = [name for name, count in registrations.items() if count != 1]
    require(not duplicates, 'ShellSpec 중복 등록: ' + ', '.join(sorted(duplicates)))
    return len(scripts)


def check_ci(root: Path) -> None:
    workflow = (root / '.github/workflows/ci.yml').read_text(encoding='utf-8')
    lines = workflow.splitlines()
    start = next((i for i, line in enumerate(lines)
                  if JOB_HEADER.fullmatch(line) and
                  JOB_HEADER.fullmatch(line).group(1) == 'contracts'), None)
    require(start is not None, 'CI contracts 작업 누락')
    end = next((i for i in range(start + 1, len(lines)) if JOB_HEADER.fullmatch(lines[i])), len(lines))
    job = '\n'.join(lines[start:end])
    require(not re.search(r'^    (?:if|continue-on-error):', job, re.MULTILINE),
            'CI contracts 작업은 조건부이거나 실패를 무시하면 안 됩니다')
    steps = re.split(r'(?=^      - name: )', job, flags=re.MULTILINE)
    required = [
        ('Verify all tests are included in CI', 'sh tests/test-suite-integrity.sh'),
        ('Verify OpenWrt 25.12 BusyBox compatibility', 'sh tests/test-openwrt-commands.sh'),
        ('Run ShellSpec contracts', 'shellspec'),
    ]
    positions = {}
    for title, command in required:
        matching = [(index, step) for index, step in enumerate(steps)
                    if re.search(r'^      - name: ' + re.escape(title) + r'\s*$', step, re.MULTILINE)]
        require(len(matching) == 1, f'CI 단계 누락/중복: {title}')
        index, step = matching[0]
        require(not re.search(r'^        (?:if|continue-on-error):', step, re.MULTILINE),
                f'조건부 실행 또는 오류 무시: {title}')
        require(bool(re.search(r'^        run: ' + re.escape(command) + r'\s*$', step, re.MULTILINE)),
                f'CI 실행 명령이 다릅니다: {title}')
        positions[title] = index
    require(positions[required[0][0]] < positions[required[1][0]] < positions[required[2][0]],
            'CI 사전 검증이 ShellSpec보다 먼저 실행되어야 합니다')
    shellspec_installs = [i for i, step in enumerate(steps)
                          if '      - name: Install ShellSpec\n' in step]
    require(len(shellspec_installs) == 1 and
            positions[required[1][0]] < shellspec_installs[0] < positions[required[2][0]],
            'ShellSpec 설치 순서가 올바르지 않습니다')
    require('SHELLSPEC_VERSION: 0.28.1' in steps[shellspec_installs[0]],
            'ShellSpec 버전 고정 누락')
    require('tests/run.sh' not in workflow, '삭제된 tests/run.sh를 CI가 참조합니다')
    lint_start = next((i for i, line in enumerate(lines)
                       if JOB_HEADER.fullmatch(line) and
                       JOB_HEADER.fullmatch(line).group(1) == 'lint'), None)
    require(lint_start is not None, 'CI lint 작업 누락')
    lint_end = next((i for i in range(lint_start + 1, len(lines))
                     if JOB_HEADER.fullmatch(lines[i])), len(lines))
    lint_job = '\n'.join(lines[lint_start:lint_end])
    require(not re.search(r'^    (?:if|continue-on-error):', lint_job, re.MULTILINE),
            'CI lint 작업은 조건부이거나 실패를 무시하면 안 됩니다')
    lint_steps = re.split(r'(?=^      - name: )', lint_job, flags=re.MULTILINE)
    lint_runs = [step for step in lint_steps
                 if re.search(r'^      - name: Run all language linters\s*$', step, re.MULTILINE)]
    require(len(lint_runs) == 1 and
            re.search(r'^        run: sh tools/lint.sh\s*$', lint_runs[0], re.MULTILINE) and
            not re.search(r'^        (?:if|continue-on-error):', lint_runs[0], re.MULTILINE),
            'CI lint 실행 단계가 누락되거나 실패를 무시합니다')


def check(root: Path) -> int:
    count = check_specs(root)
    check_ci(root)
    return count


def self_test() -> None:
    """Real mutations must be rejected by the same coverage gate used in CI."""
    with tempfile.TemporaryDirectory(prefix='arcdrop-ci-') as tmp:
        root = Path(tmp)
        for directory in ('tests', 'spec', '.github/workflows'):
            (root / directory).mkdir(parents=True)
        (root / '.shellspec').write_text('--shell sh\n--format documentation\n', encoding='utf-8')
        test = root / 'tests/test_example.py'
        test.write_text('print("PASS")\n', encoding='utf-8')
        spec = root / 'spec/contracts_spec.sh'
        original_spec = ('Describe "ArcDrop contracts"\n'
                         '  When run command python3 "$SHELLSPEC_PROJECT_ROOT/tests/test_example.py"\n'
                         'End\n')
        spec.write_text(original_spec, encoding='utf-8')
        ci = root / '.github/workflows/ci.yml'
        original_ci = '''jobs:
  contracts:
    runs-on: ubuntu-latest
    steps:
      - name: Verify all tests are included in CI
        run: sh tests/test-suite-integrity.sh
      - name: Verify OpenWrt 25.12 BusyBox compatibility
        run: sh tests/test-openwrt-commands.sh
      - name: Install ShellSpec
        env:
          SHELLSPEC_VERSION: 0.28.1
      - name: Run ShellSpec contracts
        run: shellspec
'''
        original_ci += '''  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Run all language linters
        run: sh tools/lint.sh
'''
        ci.write_text(original_ci, encoding='utf-8')
        require(check(root) == 1, '테스트 무결성 기본 fixture 실패')

        def must_fail(fragment: str) -> None:
            try:
                check(root)
            except CoverageError as exc:
                require(fragment in str(exc), f'예상 밖의 오류: {exc}')
            else:
                raise CoverageError(f'변이 테스트 통과 오류: {fragment}')

        extra = root / 'tests/test_frontend.mjs'
        extra.write_text('console.log("test")\n', encoding='utf-8')
        must_fail('미등록')
        tap_spec = original_spec.replace(
            'End\n',
            '  When run command node --test --test-reporter=tap '
            '"$SHELLSPEC_PROJECT_ROOT/tests/test_frontend.mjs"\nEnd\n',
        )
        spec.write_text(tap_spec, encoding='utf-8')
        require(check(root) == 2, 'Node.js TAP 명시적 등록 실패')
        spec.write_text(tap_spec.replace('node --test --test-reporter=tap', 'node'),
                        encoding='utf-8')
        must_fail('미등록')
        spec.write_text(original_spec, encoding='utf-8')
        extra.unlink()
        extra = root / 'tests/test_new.sh'
        extra.write_text('#!/bin/sh\n', encoding='utf-8')
        must_fail('미등록')
        extra.unlink()
        spec.write_text(original_spec.replace('End\n',
            '  When run command python3 "$SHELLSPEC_PROJECT_ROOT/tests/test_example.py"\nEnd\n'),
            encoding='utf-8')
        must_fail('중복')
        spec.write_text(original_spec.replace('test_example.py', 'test_absent.py'),
                        encoding='utf-8')
        must_fail('미등록')
        spec.write_text(original_spec, encoding='utf-8')
        hidden = root / 'spec/hidden.sh'
        hidden.write_text('Describe "hidden"\nEnd\n', encoding='utf-8')
        must_fail('자동 검색 대상')
        hidden.unlink()
        for command in ('sh tests/test-suite-integrity.sh',
                        'sh tests/test-openwrt-commands.sh', 'shellspec'):
            ci.write_text(original_ci.replace(f'run: {command}', 'run: echo skipped'),
                          encoding='utf-8')
            must_fail('CI 실행 명령')
        for bad, fragment in (
            ('      - name: Verify all tests are included in CI\n'
             '        if: false\n', '조건부'),
            ('      - name: Run ShellSpec contracts\n'
             '        continue-on-error: true\n', '오류 무시'),
        ):
            name = bad.splitlines()[0] + '\n'
            ci.write_text(original_ci.replace(name, bad), encoding='utf-8')
            must_fail(fragment)
        ci.write_text(original_ci.replace('SHELLSPEC_VERSION: 0.28.1',
                                           'SHELLSPEC_VERSION: latest'), encoding='utf-8')
        must_fail('버전 고정')
        swapped = original_ci.replace(
            '      - name: Verify all tests are included in CI\n'
            '        run: sh tests/test-suite-integrity.sh\n'
            '      - name: Verify OpenWrt 25.12 BusyBox compatibility\n'
            '        run: sh tests/test-openwrt-commands.sh\n',
            '      - name: Verify OpenWrt 25.12 BusyBox compatibility\n'
            '        run: sh tests/test-openwrt-commands.sh\n'
            '      - name: Verify all tests are included in CI\n'
            '        run: sh tests/test-suite-integrity.sh\n')
        ci.write_text(swapped, encoding='utf-8')
        must_fail('CI 사전 검증')
        ci.write_text(original_ci.replace('run: sh tools/lint.sh', 'run: echo skipped'),
                      encoding='utf-8')
        must_fail('CI lint 실행 단계')
        ci.write_text(original_ci.replace('  lint:', '  no-lint:'), encoding='utf-8')
        must_fail('CI lint 작업 누락')
        ci.write_text(original_ci, encoding='utf-8')
        require(check(root) == 1, '변이 테스트 후 복구 실패')


def main() -> int:
    try:
        count = check(ROOT)
        if '--self-test' in sys.argv[1:]:
            self_test()
    except (CoverageError, OSError) as exc:
        print(f'FAIL: ArcDrop CI test coverage: {exc}', file=sys.stderr)
        return 1
    print(f'PASS: ArcDrop {count}개 테스트가 ShellSpec과 CI에 각각 한 번 등록되었습니다')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
