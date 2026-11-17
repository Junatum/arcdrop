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

  It 'OpenWrt Build/Prepare가 빌드 디렉터리를 생성하고 소스와 라이선스를 복사한다'
    When run command sh "$SHELLSPEC_PROJECT_ROOT/tests/test-build-prepare.sh"
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
