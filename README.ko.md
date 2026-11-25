# ArcDrop

[English](README.md) | **한국어**

[![CI](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml/badge.svg)](https://github.com/Junatum/arcdrop/actions/workflows/ci.yml)
![OpenWrt](https://img.shields.io/badge/OpenWrt-25.12-blue)
![License](https://img.shields.io/badge/License-GPL--3.0--or--later-blue)

**ArcDrop**은 SmartSafeHub와 OpenWrt 공유기를 위한 경량 로컬 파일 공유 앱입니다. 같은 네트워크의 기기끼리 클라우드 업로드 없이 브라우저에서 직접 파일을 주고받습니다.

- 패키지: `smartsafehub-app-arcdrop` (`1.0.0-r1`)
- 환경: **OpenWrt 25.12**, uHTTPd HTTPS 및 CGI
- 라이선스: **GPL-3.0-or-later**
- 상태: **1.0 정식 출시**

## 주요 기능

- **기기 간 직접 전송**: WebRTC 기반 암호화 P2P 전송. 외부 STUN/TURN 서버를 사용하지 않습니다.
- **공유기에 파일 미저장**: 공유기는 기기 검색·승인·시그널링만 처리하고, 임시 연결 정보는 자동으로 만료됩니다.
- **수신자 승인**: 상대 기기가 수신을 승인한 후에만 파일을 전송합니다.
- **간편한 화면**: 주변 기기 검색, 기기 이름 변경, 드래그 앤 드롭, 모바일 화면, 라이트·다크 모드 지원.
- **로컬 네트워크 보호**: HTTPS와 신뢰된 IPv4 LAN에서만 접근하며, 파일은 **최대 64 MiB**까지 전송합니다(브라우저당 동시 1건).

## 빠른 시작

[설치 가이드](docs/INSTALLATION.md)에 따라 OpenWrt 패키지를 빌드·설치합니다. 공유기 LAN 호스트명에 맞고 브라우저에서 신뢰하는 HTTPS 인증서가 필요합니다.

같은 신뢰된 LAN에 연결된 두 기기에서 다음 주소를 엽니다.

```text
https://<공유기-LAN-호스트>/arcdrop/
```

상대 기기를 선택하고 파일을 고른 뒤, 수신 기기에서 요청을 승인합니다. 전송이 끝나면 **파일 저장**을 누릅니다. 저장을 요청하면 5초 카운트다운 후 안내창이 자동으로 닫힙니다.

**현재 제한:** 신뢰된 IPv4 LAN 전용이며, 원격·IPv6·클라이언트 격리 네트워크에서는 사용할 수 없습니다. 실제 공유기와 모바일 브라우저 검증은 진행 중입니다. 자세한 내용은 [배포·보안](docs/DEPLOYMENT.md)과 [검증 가이드](docs/VALIDATION.md)를 확인하세요.

## 화면 미리보기

```sh
cd web
python3 -m http.server 8080 --bind 127.0.0.1
```

[http://127.0.0.1:8080/demo.html](http://127.0.0.1:8080/demo.html)에서 확인할 수 있습니다. 디자인용 데모는 **실제 파일을 전송하지 않으며**, 공유기 패키지에도 포함되지 않습니다.

## 개발 및 테스트

```sh
shellspec
sh tools/lint.sh
```

개발 환경 준비, OpenWrt 빌드와 브라우저 E2E 테스트는 [한국어 개발 가이드](docs/ko/DEVELOPMENT.md) ([English](docs/DEVELOPMENT.md))를 참고하세요.

## 문서

| 문서 | 내용 |
| --- | --- |
| [설치](docs/INSTALLATION.md) | OpenWrt 빌드, 설치 및 삭제 |
| [아키텍처](docs/ARCHITECTURE.md) | WebRTC, CGI, 데이터 흐름과 보안 경계 |
| [배포·보안](docs/DEPLOYMENT.md) | HTTPS, LAN 접근 제한 및 주의 사항 |
| [개발 가이드](docs/ko/DEVELOPMENT.md) | 개발 환경, 테스트 및 문제 해결 |
| [검증](docs/VALIDATION.md) | 정식 출시 전 실기기 점검 |
| [변경 내역](CHANGELOG.md) | 버전별 변경 사항 |

## 라이선스

이 프로젝트는 [GPL-3.0-or-later](LICENSE) 조건으로 배포됩니다.
