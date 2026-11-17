# ArcDrop 개발 가이드

**언어:** [English](../DEVELOPMENT.md) | [한국어](DEVELOPMENT.md)

> 기준 소스: ArcDrop `0.1.0-r14`. 2026-11-17.
>
> 개발·테스트·디자인 미리보기를 위한 문서입니다. **정적 UI 미리보기와 실제 WebRTC 전송 테스트는 별개**입니다.

## 1. 프로젝트 개요

ArcDrop은 SmartSafeHub 공식 OpenWrt 앱으로 개발하는, LAN 전용 파일 공유 애플리케이션입니다.

- 라이선스: **GPL-3.0-or-later**. PairDrop/Snapdrop 소스와 에셋을 복제하지 않고 독립 구현합니다.
- 브라우저 간 실제 파일 데이터 전송: **WebRTC RTCDataChannel** (`iceServers: []`, 외부 STUN/TURN 사용 안 함).
- 공유기의 역할: 정적 웹페이지 제공과 CGI를 통한 기기 검색·승인·SDP/ICE 시그널링.
- 공유기는 **파일 본문을 저장하거나 중계하지 않습니다**. `/tmp/arcdrop`에는 만료되는 기기·세션·시그널링 메타데이터만 둡니다.
- OpenWrt 웹 서버: 기존 **uHTTPd HTTPS 및 `/cgi-bin`** 사용. 별도 Node.js 데몬·데이터베이스·인증서 발급 서버 없음.
- MVP 전송 범위: **파일 1개, 최대 64 MiB**, 16 KiB 청크, 브라우저당 동시 전송 1회.
- 상태: 설계/계약 테스트 중심 MVP. 지원 공유기별 실기기 E2E 및 SmartSafeHub Apps 등록은 아직 미완료.

## 2. 주요 파일 구조

```text
arcdrop/
├── .shellspec                  # ShellSpec 실행/출력 설정
├── .github/workflows/ci.yml   # 자동 계약 테스트
├── Makefile                   # OpenWrt 패키지 정의 및 설치
├── root/etc/arcdrop.conf      # 설치 후 /etc/arcdrop.conf
├── src/arcdrop.c              # CGI 요청 진입점 및 라우팅
├── src/arcdrop.h              # 요청 컨텍스트 및 공통 인터페이스
├── src/{http,lan,peer_store,session,signaling,json_helpers}.c # 기능별 C 모듈
├── web/
│   ├── index.html             # 화면 마크업
│   ├── style.css              # 다크/라이트·반응형 스타일
│   ├── icon.svg               # 공통 ArcDrop 무한대 전송 흐름 SVG
│   └── app.js                 # 기기 검색, 초대/승인, WebRTC 전송
├── spec/contracts_spec.sh     # 한글 ShellSpec 계약
├── tests/                     # Python/Node.js/셸 단위·계약 테스트
├── tools/check_test_coverage.py
├── e2e/browser_e2e.py         # 선택 실행 실브라우저 통합 테스트
├── docs/
│   ├── DEVELOPMENT.md         # 영어 개발 가이드
│   ├── ko/DEVELOPMENT.md      # 현재 문서 (한국어)
│   ├── INSTALLATION.md        # OpenWrt 설치
│   ├── ARCHITECTURE.md        # 내부 구조
│   └── DEPLOYMENT.md          # 배포·보안 검토
├── LICENSES/                  # 라이선스 고지 및 원문
├── CHANGELOG.md              # 영문 릴리스 기록 (릴리스 사이 빈 줄 하나)
├── CONTRIBUTING.md, SECURITY.md
└── README.md, README.ko.md
```

**빌드 산출물 정책:** 웹 소스는 번들러가 필요 없는 HTML/CSS/JavaScript입니다. 프론트엔드 `dist/`, `build/` 같은 빌드 파일은 생성하거나 커밋하지 않습니다.

## 3. 개발 환경 (macOS)

기본 도구: Python 3, Node.js, C 컴파일러(Apple Command Line Tools), ShellSpec. CGI 호스트 테스트에는 `json-c`가 필요합니다. CI는 ShellSpec `0.28.1`, Node.js `24`, Ubuntu 24.04 환경을 사용합니다.

```bash
# C 컴파일러가 없다면 설치
xcode-select --install

# CGI 호스트 테스트 의존성
brew install json-c pkgconf

# 현재 버전 확인
python3 --version
node --version
cc --version
shellspec --version
```

이미 도구가 준비되어 있다면 재설치할 필요는 없습니다. `pkgconf` 명령이 없는 환경도 Homebrew의 `json-c` 경로를 찾도록 CGI 테스트를 보강했지만, **`json-c` 헤더와 라이브러리 자체는 필요**합니다.

## 4. 화면 디자인만 로컬에서 확인하기 (백엔드 불필요)

실제 파일 전송과 관계없이 **디자인 데모**를 실행할 수 있습니다.

```bash
cd ~/Projects/arcdrop/web
python3 -m http.server 8080 --bind 127.0.0.1
```

브라우저에서 **`http://127.0.0.1:8080/demo.html`** 을 엽니다. 가상 기기 3대, 기기 없음, 수신 요청, 전송 진행률, 완료, HTTPS 오류를 화면 위의 버튼으로 확인할 수 있습니다.

- 가운데 내 기기에서 **5개의 파형**이 시간차를 두고 퍼져나갑니다. 데스크톱에서 최대 지름은 약 900px이며 `prefers-reduced-motion`을 따릅니다.
- 실제 운영 UI와 디자인 데모는 같은 `icon.svg`를 사용합니다.
- 다크/라이트 테마는 헤더의 테마 버튼으로 전환할 수 있습니다.
- 모바일 레이아웃은 Chrome 개발자 도구 `Cmd+Option+I` → `Cmd+Shift+M`에서 확인합니다.
- 데모는 파일 전송이나 CGI 호출을 하지 않으며 `demo.html`, `demo.js`는 공유기 패키지에 포함하지 않습니다.
- `http://127.0.0.1:8080/`에서 실제 `index.html`도 볼 수 있지만, HTTPS가 아니므로 API 등록을 시작하지 않습니다.
- Python 정적 서버는 `/cgi-bin/arcdrop`을 제공하지 않습니다. 별도 빌드나 백엔드 없이 UI만 확인하는 용도입니다.

## 5. 자동 계약 테스트 (ShellSpec)

프로젝트 루트에서 실행합니다.

```bash
cd ~/Projects/arcdrop
shellspec
```

현재 `spec/contracts_spec.sh`의 10개 항목:

1. CGI HTTPS/LAN 제한, 세션 인증, 수신 승인, 파일 미저장
2. 브라우저 WebRTC P2P/청크/외부 스크립트 차단
3. 중앙 파형, 모바일 UI 및 디자인 데모 격리
4. JavaScript 문법
5. OpenWrt 25.12 BusyBox 명령 호환성
6. 패키지 설치 경로/의존성/미저장 정책
7. OpenWrt Makefile의 Build/Prepare 실행과 소스 복사 검증
8. CHANGELOG 버전과 릴리스 사이 빈 줄 하나
9. 문서 언어와 내부 링크 검증
10. 신규 테스트 등록 및 CI 실행 누락 방지

개별 검증도 가능합니다.

```bash
python3 tests/test_cgi.py
node --test --test-reporter=tap tests/test_frontend.mjs
node --test --test-reporter=tap tests/test_ui.mjs
sh tests/test-js-syntax.sh
sh tests/test-openwrt-commands.sh
sh tests/test-package-contract.sh
sh tests/test-build-prepare.sh
sh tests/test-changelog-spacing.sh
sh tests/test-docs-contract.sh
sh tests/test-suite-integrity.sh
```

Node.js 테스트는 `--test-reporter=tap`을 명시합니다. Node.js 기본 출력의 `ℹ pass`와 TAP의 `# pass` 차이로 인한 ShellSpec 실패를 방지하기 위함입니다.

CI는 테스트 등록 누락 검사 → BusyBox 검사 → 필수 도구/라이브러리 설치 → ShellSpec 실행 순서입니다. `tests/`에 테스트 파일을 추가하면 `spec/contracts_spec.sh`에 **한 번만 등록**해야 하며, 누락하면 무결성 검사가 실패합니다.

## 6. 선택형 실브라우저 E2E 테스트

선택 실행 파일은 `e2e/browser_e2e.py`입니다. 임시 HTTPS 서버, CGI 테스트 바이너리, Playwright의 **브라우저 2개 컨텍스트**로 WebRTC 파일 전송과 저장 결과를 검증하도록 작성되어 있습니다.

```bash
# 의존성 준비 예시 (테스트 용도)
python3 -m pip install playwright
python3 -m playwright install chromium

# Mac에서도 실행 가능 (json-c 및 C 컴파일러 필요)
python3 e2e/browser_e2e.py
```

**현재 상태:** macOS Homebrew의 `json-c`, LibreSSL 및 Chrome/Chromium 실행 경로를 탐색하도록 개선했습니다. `brew install json-c pkgconf` 후 E2E를 실행할 수 있습니다. 다만 macOS 실브라우저 실행과 iPadOS 실기기 검증은 이 환경에서 확인하지 못했으므로 성공을 보장하지 않습니다. 선택형 테스트의 결과와 ShellSpec 계약 결과는 구분해 주세요.

E2E 테스트의 임시 인증서와 `ARCDROP_TEST_MODE`는 **테스트 전용**입니다. 프로덕션 공유기의 CGI 보안 검사를 완화하기 위해 사용하면 안 됩니다.

## 7. 실제 OpenWrt 패키지 빌드

ArcDrop 저장소 전체를 OpenWrt **25.12 빌드 트리의 `package/arcdrop`**으로 배치하거나 심볼릭 링크합니다. 실제 사용 중인 빌드 트리 경로에 맞춰 수정하세요.

```bash
cd /path/to/openwrt
ln -s /path/to/arcdrop package/arcdrop
make menuconfig
make package/arcdrop/compile V=s
find bin/packages -name 'smartsafehub-app-arcdrop*.apk'
```

- `Makefile`의 패키지 이름은 `smartsafehub-app-arcdrop`이며 의존성은 `uhttpd`, `libjson-c`입니다.
- 공유기에 설치되는 소스 경로: `web/` → `/www/arcdrop/`, 네이티브 CGI → `/www/cgi-bin/arcdrop`, `root/etc/arcdrop.conf` → `/etc/arcdrop.conf`.
- 저장소의 `root/etc/arcdrop.conf` 기본값은 `lan_interface=br-lan`입니다.
- 지원 타깃별 크로스 빌드와 배포용 패키지 호환성은 별도 검증이 필요합니다.

## 8. 공유기 실기기 검증

1. 로컬 빌드한 신뢰 가능한 APK를 공유기에 설치합니다. 공개 배포에는 정식 서명된 패키지를 사용합니다.
2. `uHTTPd` HTTPS 리스너, `/www` 문서 루트, `/cgi-bin` 실행 설정을 확인합니다.
3. **브라우저가 신뢰하고 접속 도메인과 일치하는 TLS 인증서**를 사용합니다. 경고 화면을 무시하는 절차는 공개 출시 방식이 될 수 없습니다.
4. 동일한 허용 LAN에서 Mac과 스마트폰의 `https://<공유기-LAN-호스트>/arcdrop/`를 엽니다.
5. 상대 기기 검색 → 파일 선택 → 초대 → 수신 승인 → 전송 → 파일 다운로드와 바이트 동일성을 확인합니다.
6. 수신 거절, 중도 취소, 기기 이탈, 빈 파일, 64 MiB 상한, 게스트 Wi-Fi/VLAN 차단을 확인합니다.
7. `/tmp/arcdrop` 및 영구 저장소에 **파일 내용이 저장되지 않고 메타데이터만 존재하는지** 확인합니다.

> ArcDrop은 자동으로 공인 인증서를 발급하지 않습니다. TLS가 준비되지 않은 장치에서는 UI 확인과 실제 P2P 검증 결과를 구분해서 보고하세요.

상세 위협 모델, 인증서 정책, 배포 전 점검은 [`DEPLOYMENT.md`](../DEPLOYMENT.md)를 참고합니다.

## 9. 자주 발생하는 문제

| 현상 | 확인할 사항 |
|---|---|
| `localhost` 화면에 빨간 HTTPS 안내 | 정상적인 HTTP 정적 미리보기 상태. 실제 등록은 실행되지 않음 |
| 주변 기기 0대, 내 기기 '연결 중…' | 정적 서버에는 HTTPS·CGI가 없어 검색 불가능 |
| CSS/화면 수정 사항이 반영되지 않음 | 브라우저 새로고침 및 개발자 도구 캐시 확인 |
| ShellSpec CGI 테스트에서 `json-c` 오류 | `brew install json-c pkgconf`, C 컴파일러 및 라이브러리 경로 확인 |
| ShellSpec Node 테스트에서 출력 형식 오류 | `node --test --test-reporter=tap` 사용 여부 확인 |
| `e2e/browser_e2e.py`가 Mac에서 실패 | `brew install json-c pkgconf`, `python3 -m playwright install chromium`, 필요 시 `ARCDROP_E2E_BROWSER_PATH` 사용 |
| 실기기에서 웹페이지 404 | `/www/arcdrop/index.html` 설치 경로 확인 |
| 실기기에서 CGI 404/403 | `/cgi-bin/arcdrop`, HTTPS, Origin, 허용 LAN 인터페이스 확인 |
| 상대 기기는 보이나 WebRTC 연결 실패 | 네트워크 격리·VLAN·ICE host 후보·브라우저 호환성 확인 |

## 10. 현재 적용된 UI 구조

과거의 세로 카드형 화면은 **내 기기 중심의 주변 기기 검색 UI**로 개편되었습니다.

- 내 기기 아이콘이 가운데 표시되고 주변 기기를 원형으로 배치합니다.
- 가운데에서 5개 파동이 확산됩니다. 기존 고정 원형 라인은 표시하지 않습니다.
- **상대 기기 선택 → 파일 선택 → 수신자 승인 → 직접 전송** 순서로 동작합니다.
- 수신 승인·진행률·완료는 모달로 표시하며, 모바일에서는 주변 기기 레이아웃이 조정됩니다.
- 헤더는 전체 화면 너비를 사용하며, 다크/라이트 테마를 직접 전환할 수 있습니다.
- 디자인 데모는 운영용 API/HTTPS 검사를 우회하지 않고 독립 HTML/JS로만 구현되어 있습니다.

## 11. 변경 전 검증 체크리스트

- [ ] `shellspec` 전체 통과
- [ ] 신규 테스트의 `spec/contracts_spec.sh` 등록과 CI 무결성 검사 통과
- [ ] 정적 데스크톱/모바일, 다크/라이트 화면 검토
- [ ] 화면 개편 시 수신 승인/전송 취소/64 MiB 제한 회귀 확인
- [ ] 외부 자산·런타임 의존성·프론트엔드 빌드 파일이 추가되지 않았는지 확인
- [ ] 공유기 파일 미저장, HTTPS, LAN 격리 정책 유지
- [ ] 릴리스 시 Makefile 버전, 화면 버전, 영어 CHANGELOG 및 한국어 문서 동기화
- [ ] CHANGELOG 릴리스 블록 사이에 빈 줄을 하나만 유지
- [ ] 실기기 E2E 미검증 사항을 완료로 표기하지 않음

### ICE 시그널링 (0.1.0-r9)

Offer/Answer를 전송하기 전 로컬 ICE 후보 수집을 최대 10초간 기다리고 SDP에 함께 포함합니다. 이전 버전의 개별 ICE 후보 메시지도 수신할 수 있습니다. 외부 STUN/TURN 서버나 공유기의 파일 중계 기능은 추가하지 않았습니다. LAN 경로가 막혀 있으면 여전히 연결에 실패할 수 있습니다.

### 주변 기기 탐지와 모바일 복구 (0.1.0-r10)

- 주변 기기 검색은 기존 LAN 전용 CGI 방식이며, 공유기가 네트워크를 스캔하거나 외부 서버에 의존하지 않습니다.
- 새로고침 후에는 `sessionStorage`에 저장된 탭별 세션을 `heartbeat`로 검증하여 재사용합니다. 만료된 경우에만 재등록하며, 세션 토큰을 `localStorage`에 보관하지 않습니다.
- iPadOS의 백그라운드 복귀(`visibilitychange`, `pageshow`)와 네트워크 복귀(`online`) 시 세션을 확인하고 기기 목록을 다시 불러옵니다. 45초 넘게 중단된 세션은 다시 등록할 수 있습니다.
- 주변 기기 목록은 서버 반환 순서에 영향받지 않고 기존 기기 버튼·위치를 유지합니다. 6대를 초과하면 기존 목록 레이아웃을 사용합니다.
- 연필 버튼으로 **기기 이름과 아이콘**을 변경할 수 있습니다. 종류는 노트북·데스크톱·태블릿·스마트폰 중 선택하며, 서버의 인증된 `profile` API로 즉시 변경됩니다. 저장소 접근이 막혀 있어도 기본 설정으로 동작합니다.
- **Bowser를 넣지 않은 이유:** UA 분석 라이브러리로도 실제 iPad Pro/맥북 모델명은 정확히 알기 어렵습니다. 외부 스크립트·번들·새 종속성을 만들지 않고 사용자가 종류를 직접 교정할 수 있도록 했습니다.
- 새로고침과 탭 복구 사이의 세션 충돌을 피하기 위해 종료 시 `sendBeacon`을 보내지 않습니다. 닫힌 탭은 최대 45초 동안 보일 수 있으며 다른 탭의 세션은 독립적입니다.

`node --test --test-reporter=tap tests/test_discovery.mjs`와 `shellspec`을 실행하세요. 실기기에서는 iPad 브라우저를 45초 이상 백그라운드에 둔 뒤 되돌아와 자동으로 기기가 다시 나타나는지 확인하고, 이름·아이콘이 다른 기기에도 보이는지 확인합니다.

### 적응형 기기 탐지 및 활동 상태 (0.1.0-r11)

클라이언트는 `poll` 요청에 `visible`, `busy` 불리언 값을 선택적으로 포함합니다. CGI는 잘못된 타입을 거부하고, 필드가 없는 구버전 클라이언트도 계속 지원합니다. `peers` 응답의 `available`, `busy`, `away`, `stale` 상태는 마지막 폴링 시각(8초 기준), 화면 활성 여부, 전송 상태를 참고합니다. 이 상태는 **기기 인증이나 WebRTC 직접 연결 가능 여부를 보장하는 신호가 아닙니다.**

- 신호 확인: 전경 대기 1,800ms / 전송 중 700ms / 백그라운드 대기 12,000ms
- 주변 기기 목록: 대기 중 6,500ms / 전송 중 3,500ms
- 일시적인 CGI 오류에는 제한된 재시도 간격을 적용하며 정상적인 WebRTC 전송을 즉시 취소하지 않습니다.
- 백그라운드에서는 주변 기기 목록을 조회하지 않습니다. `visibilitychange` 시 탐지 대기를 해제합니다. 모바일 OS 타이머 제한과 기존 45초 세션 만료는 그대로 적용됩니다.
- STUN/TURN을 추가하지 않았으며 공유기에서 파일 본문을 저장하지 않습니다.

코드 변경 후 `shellspec`을 실행합니다. CGI 및 Node 테스트에는 상태 전환, 구버전 클라이언트, 응답 지연, 모바일 복귀 시나리오가 추가되었습니다.

### 선택형 실브라우저 E2E 개선 (0.1.0-r13)

macOS Homebrew/LibreSSL과 Linux의 라이브러리 및 브라우저 실행 경로를 자동 탐색합니다. 양방향 전송·수신 거절·라우터 파일 본문 미저장을 선택형 테스트로 검증하도록 확장했습니다. Mac에서는 `brew install json-c pkgconf`, `python3 -m playwright install chromium` 실행 후 `python3 e2e/browser_e2e.py`를 사용하세요. 실제 iPadOS 브라우저 테스트와 공인 HTTPS 신뢰, SmartSafeHub Apps 카탈로그 통합은 아직 필요합니다. 상세 검증은 [VALIDATION.md](../VALIDATION.md)를 참조하세요.
