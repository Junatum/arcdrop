#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import json
import re
import sys
import tomllib

root = Path(sys.argv[1])

def require(value, label):
    if not value:
        raise SystemExit('FAIL: ' + label)

files = ('eslint.config.mjs', '.stylelintrc.json', '.htmlvalidate.json',
         'pyproject.toml', '.clang-tidy', '.yamllint.yml', 'package.json',
         'tools/lint.sh', 'tools/check_svg.py')
for file in files:
    require((root / file).is_file(), f'lint 설정 누락: {file}')

package = json.loads((root / 'package.json').read_text())
require(package.get('private') is True, 'lint 도구는 npm 비공개 호스트 전용')
for name in ('eslint', 'stylelint', 'html-validate'):
    require(name in package['devDependencies'], f'{name} 의존성 누락')
    require(name in package['scripts'][f'lint:{"js" if name == "eslint" else "css" if name == "stylelint" else "html"}'],
            f'{name} 실행 명령 누락')
require(all(re.fullmatch(r'\d+\.\d+\.\d+', v) for v in package['devDependencies'].values()),
        'npm 직접 의존성은 정확한 버전으로 고정')
require('npm run lint:js && npm run lint:css && npm run lint:html' == package['scripts']['lint:web'],
        '웹 lint 통합 실행 누락')
with (root / 'pyproject.toml').open('rb') as stream:
    pyproject = tomllib.load(stream)
require('F' in pyproject['tool']['ruff']['lint']['select'], 'Ruff 미사용 변수 검사 누락')
for file in ('.stylelintrc.json', '.htmlvalidate.json'):
    require(json.loads((root / file).read_text())['rules'], f'검사 규칙 누락: {file}')

html_rules = json.loads((root / '.htmlvalidate.json').read_text())['rules']
# 기존에 발생한 존재하지 않는 규칙명(doctype-html5) 회귀를 차단한다.
html_supported_rules = {
    'doctype-html', 'missing-doctype', 'attr-quotes',
    'no-dup-attr', 'no-implicit-close', 'void-style',
}
require(set(html_rules) <= html_supported_rules,
        'HTML-Validate가 지원하지 않는 규칙명 사용 금지')
require(html_rules.get('doctype-html') == 'error',
        'HTML5 doctype-html 규칙 등록 누락')
require(html_rules.get('missing-doctype') == 'error',
        'DOCTYPE 누락 검사 규칙 등록 누락')
require(html_rules.get('void-style') == ['error', {'style': 'omit'}],
        'HTML-Validate void-style 규칙은 유효한 omit 값 사용')

# SC1007 regression: use an explicit empty CDPATH for root resolution.
# Keep every host-shell entry point safe when the developer sets CDPATH.
for shell_file in (*sorted((root / 'tests').glob('*.sh')),
                   *sorted((root / 'tools').glob('*.sh'))):
    shell_source = shell_file.read_text(encoding='utf-8')
    relative_name = shell_file.relative_to(root)
    require(not re.search(r'\bCDPATH=\s+cd\b', shell_source),
            f'{relative_name}: ShellCheck SC1007 (CDPATH assignment)')
    for shell_line in shell_source.splitlines():
        if shell_line.startswith('ROOT=$('):
            require("CDPATH='' cd -- " in shell_line,
                    f'{relative_name}: 명시적인 빈 CDPATH로 ROOT 탐색')

# Avoid blanket analyzer suppressions; the unavailable C11 Annex K _s
# functions produce false positives even for checked snprintf/memcpy calls.
# The other security and core analyzers must remain enabled.
clang_tidy = (root / '.clang-tidy').read_text(encoding='utf-8')
checks = re.search(r"^Checks:\s*['\"]([^'\"]+)['\"]", clang_tidy, re.M)
require(checks is not None, 'clang-tidy 검사 규칙을 읽을 수 없음')
active = checks.group(1).split(',')
require('clang-analyzer-core.*' in active and 'clang-analyzer-security.*' in active,
        'Clang 핵심·보안 정적 분석 전체 유지')
require('-clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling' in active,
        'C11 Annex K가 없는 OpenWrt에서 과도한 버퍼 API 경고만 제외')
require(not any(name == '-clang-analyzer-security.*' or name == '-clang-analyzer-core.*'
                for name in active), '보안·핵심 정적 분석 일괄 비활성화 금지')
entry = (root / 'src/arcdrop.c').read_text(encoding='utf-8')
require('lock_length < 0 || (size_t)lock_length >= sizeof(lock_path)' in entry,
        '잠금 파일 경로 잘림 검사 누락')

runner = (root / 'tools/lint.sh').read_text()
for tool in ('npm run lint:web', 'ruff check', 'shellcheck ', 'clang -std=c11',
             'clang-tidy ', 'yamllint ', 'python3 tools/check_svg.py'):
    require(tool in runner, f'언어별 lint 실행 누락: {tool}')
require('set -eu' in runner and 'exit 1' in runner, '도구 누락 시 실패하는 lint 실행기')
workflow = (root / '.github/workflows/ci.yml').read_text()
require(bool(re.search(r'^  lint:\n', workflow, re.M)), '독립 lint CI 작업 누락')
job = workflow.split('\n  lint:\n', 1)[1]
require('run: sh tools/lint.sh' in job, 'CI가 전체 lint를 실행하지 않음')
require(not re.search(r'^    (?:if|continue-on-error):', job, re.M), 'CI lint 작업의 실패 무시 금지')
require('npm install --ignore-scripts' in job and 'clang-tidy' in job, 'CI lint 설치 누락')
require('web/dist/' in (root / '.gitignore').read_text(), '빌드 파일 gitignore 누락')
require(not (root / 'web/dist').exists() and not (root / 'web/build').exists(),
        '프론트엔드 빌드 결과물 생성 금지')
print('PASS: ArcDrop 8개 소스 언어/형식 lint 설정과 실패를 무시하지 않는 CI 계약')
PYTEST
