#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
src = root / 'src'
mk = (root / 'Makefile').read_text(encoding='utf-8')
header = (src / 'arcdrop.h').read_text(encoding='utf-8')


def require(condition, message):
    if not condition:
        raise SystemExit('FAIL: ' + message)


listed = re.search(r'^ARCDROP_SOURCES:=(.+)$', mk, re.M)
require(listed, 'OpenWrt C 소스 목록이 없습니다')
files = set(listed.group(1).split())
require(files == {p.name for p in src.glob('*.c')}, 'C 모듈이 빌드에서 누락되거나 중복됩니다')
require(len(files) == 7, 'CGI가 지정된 7개 소스 모듈로 구성되어야 합니다')
require('$(addprefix ./src/,$(ARCDROP_SOURCES)) ./src/arcdrop.h' in mk,
        '빌드 준비에서 전체 C 모듈과 공통 헤더를 복사해야 합니다')
require('$(addprefix $(PKG_BUILD_DIR)/,$(ARCDROP_SOURCES))' in mk,
        '빌드 컴파일에서 같은 소스 목록을 링크해야 합니다')
require(header.index('#define _POSIX_C_SOURCE 200809L') < header.index('#include <arpa/inet.h>'),
        '공통 헤더는 OS 기능 매크로를 시스템 헤더보다 먼저 정의해야 합니다')
require('typedef struct {' in header and 'ArcContext;' in header and 'lock_fd;' in header,
        '요청별 상태 컨텍스트가 누락되었습니다')
entry = (src / 'arcdrop.c').read_text(encoding='utf-8')
require('ArcContext context = {' in entry and 'handle(app, query + 7, req)' in entry,
        'CGI 진입점에서 요청별 컨텍스트를 전달해야 합니다')
require('static const char *state_dir =' not in entry and 'static time_t now_time;' not in entry,
        '변경 가능한 전역 요청 상태가 다시 도입되었습니다')
require('handle_signal(app, me, req)' in entry and '"signal"' in entry,
        '시그널링은 전담 모듈에 전달해야 합니다')
for name, required in {
    'http.c': ('Status: %d %s', 'flock(app->lock_fd, LOCK_UN)'),
    'lan.c': ('REMOTE_ADDR', 'HTTP_ORIGIN', 'getifaddrs'),
    'peer_store.c': ('O_CREAT | O_EXCL', 'read_private_json', 'walk_peers', 'recover_peer_transaction', 'maybe_cleanup_peers'),
    'session.c': ('authenticate(', 'create_session(', 'list_peers('),
    'signaling.c': ('pending_has(', 'signal_body_ok(', 'handle_signal('),
    'json_helpers.c': ('/dev/urandom', 'is_hex(', 'json_object_new_string'),
}.items():
    content = (src / name).read_text(encoding='utf-8')
    require(all(marker in content for marker in required), f'{name} 책임 분리가 누락되었습니다')
    require('#include "arcdrop.h"' in content, f'{name} 공통 계약이 없습니다')
    require(not re.search(r'#include\s+["<].+\.c[">]', content), f'{name} 소스 직접 include 금지')
require("glob('*.c')" in (root / 'tests/test_cgi.py').read_text() and
        "glob('*.c')" in (root / 'e2e/browser_e2e.py').read_text(),
        'CGI와 선택형 브라우저 E2E는 모든 C 모듈을 컴파일해야 합니다')
require(all('main(' not in (src / name).read_text() for name in files if name != 'arcdrop.c'),
        'CGI main 진입점은 하나여야 합니다')
require('MAX_QUEUE_BYTES' in header and 'MAX_PEER_FILE' in header and 'CLEANUP_INTERVAL' in header,
        '큐 용량, 파일 크기, 정리 간격의 방어 상한을 유지해야 합니다')
require('begin_peer_transaction(app, other, me)' in (src / 'signaling.c').read_text() and
        'finish_peer_transaction(app, other, me)' in (src / 'signaling.c').read_text(),
        '시그널링 양쪽 상태는 복구 가능한 저장 절차를 사용해야 합니다')
print('PASS: CGI 모듈별 책임, 요청 컨텍스트와 단일 OpenWrt 빌드 계약')
PYTEST
