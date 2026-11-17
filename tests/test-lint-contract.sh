#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
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
require(html_rules.get('void-style') == ['error', {'style': 'omit'}],
        'HTML-Validate void-style 규칙은 유효한 omit 값 사용')

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
