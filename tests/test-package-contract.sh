#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
python3 - "$ROOT" <<'PYTEST'
from pathlib import Path
import re
import sys

root = Path(sys.argv[1])
mk = (root / 'Makefile').read_text(encoding='utf-8')
cgi = '\n'.join(p.read_text(encoding='utf-8') for p in (root / 'src').glob('*') if p.suffix in ('.c', '.h'))
readme = (root / 'README.md').read_text(encoding='utf-8')


def require(ok, message):
    if not ok:
        raise SystemExit(f'FAIL: {message}')


require(re.search(r'^PKG_NAME:=smartsafehub-app-arcdrop$', mk, re.M), '공식 앱 패키지 이름')
require(re.search(r'^PKG_LICENSE:=GPL-3\.0-or-later$', mk, re.M), 'GPLv3 or later 라이선스')
require('DEPENDS:=+uhttpd +libjson-c' in mk, 'uHTTPd 및 json-c 의존성')
require('$(INSTALL_BIN) $(PKG_BUILD_DIR)/arcdrop $(1)/www/cgi-bin/arcdrop' in mk,
        'CGI 설치 경로')
for file in ('app.js', 'index.html', 'style.css', 'icon.svg'):
    require(f'./web/{file} $(1)/www/arcdrop/{file}' in mk, f'{file} 소스 설치 경로')
    require((root / 'web' / file).is_file(), f'{file} 원본')
require('$(INSTALL_DATA) $(addprefix ./web/js/,$(ARCDROP_WEB_MODULES)) $(1)/www/arcdrop/js/' in mk,
        '모든 ES 모듈의 OpenWrt 설치 규칙')
require('$(INSTALL_DIR) $(1)/www/arcdrop $(1)/www/arcdrop/js' in mk,
        'ES 모듈 설치 디렉터리 생성')
require('$(INSTALL_CONF) ./root/etc/arcdrop.conf $(1)/etc/arcdrop.conf' in mk,
        'LAN 인터페이스 설정 설치')
config = root / 'root/etc/arcdrop.conf'
require(config.is_file(), 'root/etc 아래에 OpenWrt 설정 원본 존재')
require('lan_interface=br-lan' in config.read_text(encoding='utf-8'),
        'LAN 인터페이스 기본값 유지')
require(not (root / 'openwrt/arcdrop.conf').exists(),
        '이전 openwrt 설정 파일 경로를 사용하지 않음')
require('$(INSTALL_CONF) ./openwrt/arcdrop.conf' not in mk,
        '이전 설정 파일 경로로 설치하지 않음')
require((root / 'LICENSES/GPL-3.0.txt').is_file(), '라이선스 원문')
require((root / 'LICENSES/SOURCES.md').is_file(), '라이선스 출처')
require('iceServers: []' in (root / 'web/js/signaling.js').read_text(), '외부 STUN/TURN 비활성화')
version = re.search(r'^PKG_VERSION:=(\S+)$', mk, re.M)
revision = re.search(r'^PKG_RELEASE:=(\d+)$', mk, re.M)
require(version is not None and revision is not None, '패키지 버전 정의')
html = (root / 'web/index.html').read_text(encoding='utf-8')
require(f'ArcDrop {version.group(1)}-r{revision.group(1)}' in html,
        '앱 화면에 표시되는 버전과 실제 패키지 버전 일치')
require('/tmp/arcdrop' in cgi, '임시 시그널링 데이터 저장')
require('no file bytes are sent' in readme.lower() or 'no file bytes are sent' in
        (root / 'docs/DEPLOYMENT.md').read_text().lower(), '파일 미저장 정책 문서화')
require('demo.html' not in mk and 'demo.js' not in mk,
        '데모 전용 파일은 OpenWrt 패키지에 포함하지 않음')
require(not (root / 'web/dist').exists() and not (root / 'web/build').exists(),
        '프론트엔드 빌드 결과물 미포함')
print('PASS: ArcDrop 공식 앱 패키지, 로컬 P2P 및 라이선스 계약')
PYTEST
