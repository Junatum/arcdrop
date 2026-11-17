# ArcDrop

**언어:** [English](README.md) | [한국어](README.ko.md)

**ArcDrop — by SmartSafeHub**는 OpenWrt 공유기에서 동작하는 경량 LAN 전용 P2P 파일 공유 앱입니다.

[![Lint](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml)
![OpenWrt](https://img.shields.io/badge/OpenWrt-Compatible-blue)
![License](https://img.shields.io/github/license/Junatum/arcdrop?label=License)

- **라이선스:** GPL-3.0-or-later. PairDrop의 코드 및 리소스를 사용하지 않은 독립 구현입니다.
- **패키지:** `smartsafehub-app-arcdrop` (`0.1.0-r17`).
- **전송:** 브라우저 간 암호화된 WebRTC `RTCDataChannel`. `iceServers: []`로 외부 STUN/TURN 서버를 사용하지 않습니다.
- **파일 미저장:** 공유기는 정적 UI와 기기 검색·SDP/ICE 시그널링만 처리합니다. 파일 본문은 공유기나 클라우드에 전송하거나 저장하지 않습니다.
- **임시 정보:** 기기 이름, IP, 토큰, SDP/ICE 메시지 등의 메타데이터는 `/tmp/arcdrop`에 임시 저장되며, 비활성 세션은 45초 후 만료됩니다.
- **서버:** 기존 OpenWrt `uHTTPd` HTTPS/CGI를 재사용하며, 별도의 Node.js·Python 서버·DB·인증서 발급 서비스를 요구하지 않습니다.

## 설치 후 사용 방법

1. 공유기의 `uHTTPd` HTTPS와 브라우저가 신뢰하는 인증서가 설정되어 있는지 확인합니다. `cgi_prefix=/cgi-bin`, 웹 루트 `/www`가 필요합니다.
2. 신뢰된 LAN에 연결된 두 기기에서 `https://<공유기-LAN-호스트>/arcdrop/`을 엽니다. HTTP 접속에서는 API가 거부됩니다.
3. 상대 기기를 누르고 **최대 64 MiB의 파일 하나**를 선택합니다. 데스크톱에서는 상대 기기로 드래그 앤 드롭할 수도 있습니다.
4. 수신자가 승인하면 파일을 16 KiB 청크로 직접 전송합니다. 수신자는 **파일 저장**을 눌러 로컬에 내려받습니다.

**HTTPS 주의:** ArcDrop 자체적으로 인증서를 발급하지 않습니다. 공유기 인증서가 자체 서명이거나 주소와 일치하지 않으면 브라우저의 보안 기능이 제한될 수 있습니다. 출시용으로 보안 경고 우회를 권장하지 않습니다. [배포·보안 가이드](docs/DEPLOYMENT.md)를 확인하세요.

**기기 표시:** iPadOS Safari가 Mac으로 표시되는 경우를 구분하고, 기기 종류(태블릿·휴대폰·컴퓨터)는 사용자가 지정한 기기 이름과 별도로 전달합니다. 브라우저 개인정보 보호 정책상 MacBook Pro·iPad Pro 등의 정확한 모델명은 신뢰할 수 있게 자동 식별할 수 없으므로 이름 옆 연필 버튼으로 변경해 주세요. 기기 종류는 화면용 분류이며 기기 신원 확인 수단이 아닙니다.

**LAN 주의:** CGI는 기본적으로 `br-lan`의 IPv4 서브넷에서만 접근을 허용합니다. IPv6 또는 인터페이스를 찾지 못하면 접근을 거부합니다. 게스트 Wi-Fi·VLAN 격리와 WAN 방화벽을 유지해야 합니다. 클라이언트 격리 환경에서는 WebRTC 직접 연결이 불가능할 수 있으며 TURN으로 우회하지 않습니다.

## OpenWrt 패키지 빌드

ArcDrop 소스를 OpenWrt 빌드 트리의 `package/arcdrop`에 배치하거나 링크합니다.

```sh
ln -s /path/to/arcdrop /path/to/openwrt/package/arcdrop
cd /path/to/openwrt
make menuconfig
make package/arcdrop/compile V=s
```

OpenWrt 25.12의 APK 패키지를 대상으로 합니다. 이 저장소에는 아키텍처별 완성된 `.apk`가 아닌 **소스**만 있습니다. 삭제할 때는 패키지 관리자로 `smartsafehub-app-arcdrop`을 제거합니다. 설정 파일은 `/etc/arcdrop.conf`이고, 재부팅하면 `/tmp/arcdrop`의 임시 메타데이터가 사라집니다.

자세한 내용은 [설치 가이드](docs/INSTALLATION.md)에서 확인하세요.

## Mac에서 디자인 미리보기

```sh
cd web
python3 -m http.server 8080 --bind 127.0.0.1
```

브라우저에서 **http://127.0.0.1:8080/demo.html**을 엽니다. 가상 기기 3대, 주변 기기 없음, 수신 요청, 진행률, 완료, HTTPS 오류 상태를 볼 수 있습니다. 중앙에서 5개의 파형이 퍼지는 애니메이션과 다크/라이트 모드도 확인할 수 있습니다.

**이 화면은 실제 파일을 전송하지 않는 디자인 데모**이며 `demo.html`과 `demo.js`는 OpenWrt 패키지에 포함되지 않습니다. 일반 `index.html`은 HTTP에서 HTTPS 안내가 나타나고 CGI 등록이 수행되지 않습니다. [개발 가이드](docs/ko/DEVELOPMENT.md)를 참고하세요.

## 테스트

```sh
shellspec
```

다중 언어 lint는 필요한 개발 도구를 설치한 뒤 `sh tools/lint.sh`로 실행합니다.
선택형 CGI 커버리지 확인은 GCC/gcov를 준비하고 `sh tools/coverage.sh`를 실행하세요.
자세한 내용은 [개발 가이드](docs/ko/DEVELOPMENT.md)에 있습니다.

Jarbis와 같은 구조의 `.shellspec`, `spec/contracts_spec.sh`를 사용하며 **테스트 설명은 한국어로 유지**합니다. Python, Node.js, ShellSpec 0.28.1, C 컴파일러와 json-c 개발 헤더가 필요합니다. macOS에서는 다음으로 의존성을 준비할 수 있습니다.

```sh
brew install json-c pkgconf
```

사전 무결성·BusyBox 검사만 실행하려면 다음 명령을 사용합니다.

```sh
sh tests/test-suite-integrity.sh
sh tests/test-openwrt-commands.sh
```

## MVP 제한 사항

- 지원 공유기에서의 실기기 E2E 및 성능 검증은 아직 완료되지 않았습니다.
- 단일 파일은 최대 64 MiB이며, 브라우저당 동시 전송은 한 번입니다.
- 신뢰 가능한 HTTPS 인증서가 필요합니다. 공인 인증서 발급 자동화와 SmartSafeHub Apps 카탈로그 등록은 아직 구현하지 않았습니다.
- 신뢰된 IPv4 LAN 전용입니다. IPv6, 원격 전송, 다중 파일 대기열, 대용량 직접 디스크 스트리밍은 지원하지 않습니다.
- 페이지를 새로고침하면 진행 중인 시그널링 정보가 사라질 수 있습니다.

## 문서

- [개발 가이드 (English)](docs/DEVELOPMENT.md) · [개발 가이드 (한국어)](docs/ko/DEVELOPMENT.md)
- [설치](docs/INSTALLATION.md) · [배포 및 보안](docs/DEPLOYMENT.md)
- [아키텍처](docs/ARCHITECTURE.md)
- [기여 안내](CONTRIBUTING.md) · [보안 정책](SECURITY.md)
- [변경 이력](CHANGELOG.md)

## 소스 구조

- `src/arcdrop.c`, `src/arcdrop.h`, `src/*.c`: HTTPS·LAN 제한을 적용한 CGI 진입점과 인증·저장소·시그널링 모듈
- `web/`: 번들러 없는 HTML/CSS/JavaScript와 공통 SVG 아이콘
- `web/demo.html`, `web/demo.js`: 공유기에 설치되지 않는 로컬 디자인 데모
- `Makefile`, `root/etc/arcdrop.conf`: OpenWrt 설치 및 설정
- `spec/`, `tests/`: ShellSpec 기반 계약 테스트
- `e2e/browser_e2e.py`: 별도 실행하는 선택적 Playwright E2E 테스트

**실브라우저 WebRTC 전송은 아직 모든 개발 환경에서 검증되지 않았습니다.** 선택형 E2E의 macOS 실행 경로는 보강했지만 실제 Mac·iPad에서의 실행 확인은 별개입니다. 자동 CGI·JavaScript 테스트와 실제 전송 결과를 구분하세요.

### 기기 탐지 주기 및 연결 상태 (0.1.0-r11)

ArcDrop은 대기 중 신호 확인 1.8초, 전송 중 0.7초, 백그라운드 대기 중 12초 간격으로 폴링합니다. 기기 목록은 대기 중 6.5초, 전송 중 3.5초 간격으로 갱신합니다. 백그라운드에서는 주변 기기 목록 조회를 생략하고 브라우저에 복귀하면 즉시 탐지를 재개합니다. 다만 모바일 OS가 타이머를 지연시킬 수 있습니다.

기기는 **파일 보내기 / 전송 중 / 자리 비움 / 응답 지연** 상태로 표시됩니다. 상태는 최근 브라우저 요청을 기반으로 한 *참고 정보*이며 실제 WebRTC 연결 성공을 보장하지 않습니다. 응답하지 않거나 전송 중인 기기는 일시적으로 선택할 수 없습니다. 공유기에는 파일 본문이 저장되지 않습니다.

## 릴리스 검증

실제 기기 테스트, 선택형 macOS/Linux 브라우저 E2E 및 외부 Hub·Pipeline 통합에 필요한 작업은 [VALIDATION.md](docs/VALIDATION.md)를 확인하세요.
