# SPDX-License-Identifier: GPL-3.0-or-later

Describe 'ArcDrop ShellSpec 계약 테스트'
  It 'CGI의 HTTPS 및 LAN 제한, 세션 인증, 전송 승인과 파일 미저장을 검증한다'
    When run command python3 "$SHELLSPEC_PROJECT_ROOT/tests/test_cgi.py"
    The status should be success
    The output should include 'OK'
    The error should be blank
  End

  It '브라우저의 WebRTC P2P 전송, 청크 제한과 외부 스크립트 차단을 검증한다'
    When run command node --test --test-reporter=tap "$SHELLSPEC_PROJECT_ROOT/tests/test_frontend.mjs"
    The status should be success
    The output should include '# pass '
    The output should include '# fail 0'
    The error should be blank
  End

  It '중앙 파형, 기기 선택, 모바일 레이아웃 및 데모 격리를 검증한다'
    When run command node --test --test-reporter=tap "$SHELLSPEC_PROJECT_ROOT/tests/test_ui.mjs"
    The status should be success
    The output should include '# pass '
    The output should include '# fail 0'
    The error should be blank
  End

  It '기기 목록 안정화, 모바일 세션 복구, 프로필 편집과 저장소 제한을 검증한다'
    When run command node --test --test-reporter=tap "$SHELLSPEC_PROJECT_ROOT/tests/test_discovery.mjs"
    The status should be success
    The output should include '# pass '
    The output should include '# fail 0'
    The error should be blank
  End

  It '선택형 브라우저 E2E가 macOS 및 Linux에서 실행 가능하고 양방향 전송을 검증한다'
    When run command python3 "$SHELLSPEC_PROJECT_ROOT/tests/test_e2e_portability.py"
    The status should be success
    The output should include 'OK'
    The error should be blank
  End

  It '실제 CGI를 2·6·12개 가상 기기로 폴링하여 잠금 지연을 계측한다'
    When run command python3 "$SHELLSPEC_PROJECT_ROOT/tests/test_bench.py"
    The status should be success
    The output should include 'OK'
    The error should be blank
  End

  It '실기기에서 메타데이터를 읽지 않는 자원 샘플러를 확인한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-router-sample.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It '프론트엔드 JavaScript 문법을 확인한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-js-syntax.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'OpenWrt 25.12 BusyBox 기본 명령 사용을 확인한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-openwrt-commands.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'ArcDrop 패키지 설치 경로, 의존성과 파일 미저장 계약을 검증한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-package-contract.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'C 모듈 분리와 요청별 컨텍스트 및 OpenWrt 소스 목록을 검증한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-c-modules.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'OpenWrt Build/Prepare와 Compile이 전체 C 모듈 및 라이선스를 처리한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-build-prepare.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'CSS·HTML 가독성과 시각 동작의 기본 계약을 검증한다'
    When run command node --test --test-reporter=tap "$SHELLSPEC_PROJECT_ROOT/tests/test_web_format.mjs"
    The status should be success
    The output should include '# pass '
    The output should include '# fail 0'
    The error should be blank
  End

  It '각 언어 lint 도구와 CI 필수 검사를 확인한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-lint-contract.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It 'CHANGELOG 최신 버전과 릴리스 블록 사이 빈 줄 하나를 확인한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-changelog-spacing.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It '영어 및 한국어 문서와 내부 링크 및 문서 언어 정책을 검증한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-docs-contract.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End

  It '새 테스트가 ShellSpec에 등록되고 CI에서 빠지지 않도록 검증한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-suite-integrity.sh"
    The status should be success
    The output should start with 'PASS:'
    The error should be blank
  End
End
