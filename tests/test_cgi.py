"""ArcDrop real CGI contract tests (Korean test names)."""
import json
import os
from pathlib import Path
import shutil
import shlex
import sys
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
BIN = Path(os.environ.get('ARCDROP_TEST_BIN', '/tmp/arcdrop-host-test'))


def json_c_build_flags():
    """Find json-c on Linux or Homebrew macOS, with or without pkg-config."""
    for name in ('pkg-config', 'pkgconf'):
        executable = shutil.which(name)
        if not executable:
            continue
        result = subprocess.run(
            [executable, '--cflags', '--libs', 'json-c'],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0:
            return shlex.split(result.stdout)

    # Homebrew often has json-c installed even when pkg-config/pkgconf is absent.
    # Keep the symlinked opt prefix for stable linking across Homebrew upgrades.
    prefixes = []
    brew = shutil.which('brew')
    if brew:
        result = subprocess.run(
            [brew, '--prefix', 'json-c'],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            prefixes.append(Path(result.stdout.strip()))
    prefixes.extend((Path('/opt/homebrew/opt/json-c'), Path('/usr/local/opt/json-c')))
    for prefix in prefixes:
        if ((prefix / 'include/json-c/json.h').is_file() and
                any((prefix / 'lib' / f'libjson-c{ext}').is_file()
                    for ext in ('.dylib', '.so', '.a'))):
            return [f'-I{prefix}/include', f'-L{prefix}/lib',
                    f'-Wl,-rpath,{prefix}/lib', '-ljson-c']

    # Distribution installs may use standard compiler search paths.
    if Path('/usr/include/json-c/json.h').is_file():
        return ['-ljson-c']
    raise RuntimeError(
        'json-c 개발 라이브러리를 찾지 못했습니다. '
        'macOS: brew install json-c pkgconf / '
        'Ubuntu: sudo apt-get install libjson-c-dev pkg-config'
    )


class ArcDropHostBuildFlagsTests(unittest.TestCase):
    def test_pkg_config가_있으면_라이브러리_옵션을_조회한다(self):
        result = subprocess.CompletedProcess([], 0, '-I/test/include -L/test/lib -ljson-c\n', '')
        with patch('shutil.which', side_effect=lambda name: '/usr/bin/pkg-config' if name == 'pkg-config' else None):
            with patch('subprocess.run', return_value=result) as run:
                self.assertEqual(json_c_build_flags(), ['-I/test/include', '-L/test/lib', '-ljson-c'])
                run.assert_called_once()

    def test_macOS에서_pkg_config가_없어도_Homebrew_json_c를_찾는다(self):
        with tempfile.TemporaryDirectory(prefix='arcdrop-brew-test-') as tmp:
            prefix = Path(tmp)
            (prefix / 'include/json-c').mkdir(parents=True)
            (prefix / 'lib').mkdir()
            (prefix / 'include/json-c/json.h').touch()
            (prefix / 'lib/libjson-c.dylib').touch()
            result = subprocess.CompletedProcess([], 0, str(prefix) + '\n', '')
            with patch('shutil.which', side_effect=lambda name: '/opt/homebrew/bin/brew' if name == 'brew' else None):
                with patch('subprocess.run', return_value=result) as run:
                    self.assertEqual(json_c_build_flags(), [
                        f'-I{prefix}/include', f'-L{prefix}/lib',
                        f'-Wl,-rpath,{prefix}/lib', '-ljson-c',
                    ])
                    run.assert_called_once()


class ArcDropDarwinCompatibilityTests(unittest.TestCase):
    def test_macOS에서_Darwin_확장을_헤더보다_먼저_활성화한다(self):
        header = (ROOT / 'src/arcdrop.h').read_text(encoding='utf-8')
        sources = '\n'.join(p.read_text(encoding='utf-8') for p in (ROOT / 'src').glob('*.c'))
        self.assertIn('#include <sys/file.h>', sources)
        self.assertIn('O_CLOEXEC | O_NOFOLLOW', sources)
        feature_prefix = header.split('#include <arpa/inet.h>', 1)[0]
        feature_prefix = feature_prefix[feature_prefix.index('#if defined(__APPLE__)'):]
        self.assertIn('#define _POSIX_C_SOURCE 200809L', feature_prefix)
        # Preprocess the real source's feature-macro block, using both host
        # platform simulations without depending on a macOS SDK on CI Linux.
        probe = feature_prefix + """
#if defined(_DARWIN_C_SOURCE)
DARWIN_EXTENSIONS_ENABLED
#else
DARWIN_EXTENSIONS_DISABLED
#endif
"""
        for platform, flag, marker in (
            ('macOS', '-D__APPLE__', 'DARWIN_EXTENSIONS_ENABLED'),
            ('Linux/OpenWrt', '-U__APPLE__', 'DARWIN_EXTENSIONS_DISABLED'),
        ):
            with self.subTest(platform=platform):
                result = subprocess.run(
                    ['cc', '-E', '-P', '-x', 'c', flag, '-'],
                    input=probe, capture_output=True, text=True, check=True,
                )
                self.assertEqual(result.stdout.strip(), marker)


class ArcDropCGITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Coverage flags are opt-in and used only by the host-side gcov runner.
        extra_flags = shlex.split(os.environ.get('ARCDROP_TEST_CFLAGS', ''))
        subprocess.run([
            os.environ.get('ARCDROP_TEST_CC', 'cc'), '-std=c11', '-O2', '-Wall',
            '-Wextra', '-Werror', '-DARCDROP_TEST', *extra_flags,
            *[str(p) for p in sorted((ROOT / 'src').glob('*.c'))], '-o', str(BIN),
            *json_c_build_flags(),
        ], check=True)

    @classmethod
    def tearDownClass(cls):
        BIN.unlink(missing_ok=True)

    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='arcdrop-test-')
        os.chmod(self.tmp, 0o700)
        self.addCleanup(shutil.rmtree, self.tmp)
        self.time = 1700000000

    def call(self, action, data=None, *, env=None, raw=None):
        body = json.dumps(data or {}, ensure_ascii=False).encode() if raw is None else raw
        cgi = dict(os.environ,
            REQUEST_METHOD='POST', QUERY_STRING=f'action={action}', HTTPS='on',
            HTTP_ORIGIN='https://router.test', HTTP_HOST='router.test',
            CONTENT_TYPE='application/json', CONTENT_LENGTH=str(len(body)),
            REMOTE_ADDR='127.0.0.1', ARCDROP_TEST_MODE='1',
            ARCDROP_TEST_STATE=self.tmp, ARCDROP_TEST_NOW=str(self.time))
        if env:
            cgi.update(env)
        result = subprocess.run([str(BIN)], input=body, capture_output=True, env=cgi, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        response = result.stdout.decode()
        head, payload = response.split('\r\n\r\n', 1)
        return int(head.split(' ')[1]), json.loads(payload)

    def session(self, name):
        status, data = self.call('register', {'name': name})
        self.assertEqual(status, 200)
        self.assertEqual(len(data['id']), 24)
        self.assertEqual(len(data['token']), 48)
        return data

    def test_HTTPS가_아니면_접속을_거부한다(self):
        status, data = self.call('register', {'name': 'A'}, env={'HTTPS': 'off'})
        self.assertEqual(status, 403)
        self.assertIn('HTTPS', data['error'])

    def test_다른_오리진과_게스트_접근을_거부한다(self):
        status, _ = self.call('register', {'name': 'A'}, env={'HTTP_ORIGIN': 'https://evil.example'})
        self.assertEqual(status, 403)
        status, data = self.call('register', {'name': 'A'}, env={'REMOTE_ADDR': '10.5.1.3'})
        self.assertEqual(status, 403)
        self.assertEqual(data['error'], 'LAN only')

    def test_기기검색과_세션_검증을_수행한다(self):
        a = self.session('아이폰')
        b = self.session('노트북')
        status, data = self.call('peers', a)
        self.assertEqual(status, 200)
        self.assertEqual(data['peers'], [{'id': b['id'], 'name': '노트북'}])
        status, _ = self.call('peers', {**a, 'token': '0' * 48})
        self.assertEqual(status, 403)
        self.assertNotEqual(a['id'], b['id'])
        self.assertNotEqual(a['token'], b['token'])

    def test_기기_이름과_종류를_별도로_저장하고_주변기기에_표시한다(self):
        status, ipad = self.call('register', {'name': 'Mac', 'deviceType': 'tablet'})
        self.assertEqual(status, 200)
        status, mac = self.call('register', {'name': 'MacBook Pro', 'deviceType': 'laptop'})
        self.assertEqual(status, 200)
        status, peers = self.call('peers', mac)
        self.assertEqual(status, 200)
        self.assertEqual(peers['peers'], [{'id': ipad['id'], 'name': 'Mac', 'deviceType': 'tablet'}])
        with (Path(self.tmp) / f"{ipad['id']}.json").open(encoding='utf-8') as fp:
            saved = json.load(fp)
        self.assertEqual(saved['deviceType'], 'tablet')

    def test_기기_종류는_허용값만_사용하고_기존_등록도_유지한다(self):
        for bad in ('router', '<svg>', '', 3, None, {'type': 'tablet'}):
            with self.subTest(bad=bad):
                status, result = self.call('register', {'name': 'invalid', 'deviceType': bad})
                self.assertEqual(status, 400)
                self.assertEqual(result['error'], 'invalid device type')
        legacy = self.session('Legacy Mac')
        other = self.session('Receiver')
        status, peers = self.call('peers', other)
        self.assertEqual(status, 200)
        self.assertEqual(peers['peers'], [{'id': legacy['id'], 'name': 'Legacy Mac'}])

    def test_탐지_상태는_최근_poll과_가시성_전송여부에_따라_변경된다(self):
        ipad = self.session('iPad')
        mac = self.session('Mac')
        # Older clients with no polling status remain discoverable.
        self.assertNotIn('status', self.call('peers', mac)[1]['peers'][0])
        self.assertEqual(self.call('poll', {**ipad, 'visible': True, 'busy': False})[0], 200)
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'available')
        self.assertEqual(self.call('poll', {**ipad, 'visible': True, 'busy': True})[0], 200)
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'busy')
        self.assertEqual(self.call('poll', {**ipad, 'visible': False, 'busy': False})[0], 200)
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'away')
        self.time += 9
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'away')
        # Returning to the foreground makes a current peer available again.
        self.assertEqual(self.call('poll', {**ipad, 'visible': True, 'busy': False})[0], 200)
        self.time += 9
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'stale')
        # Presence is not a separate session expiry: 18s < 45s TTL.
        self.assertEqual(self.call('heartbeat', ipad)[0], 200)
        # An older client without flags still receives messages and is available.
        self.assertEqual(self.call('poll', ipad)[0], 200)
        self.assertEqual(self.call('peers', mac)[1]['peers'][0]['status'], 'available')

    def test_탐지_상태_플래그는_불리언만_허용하고_파일을_저장하지_않는다(self):
        ipad = self.session('iPad')
        for field in ('visible', 'busy'):
            for bad in (0, 1, 'true', 'false', [], None, {'value': True}):
                with self.subTest(field=field, bad=bad):
                    status, data = self.call('poll', {**ipad, field: bad})
                    self.assertEqual(status, 400)
                    self.assertEqual(data['error'], 'invalid presence flags')
        status, _ = self.call('poll', {**ipad, 'visible': True, 'busy': True})
        self.assertEqual(status, 200)
        state = (Path(self.tmp) / f"{ipad['id']}.json").read_text(encoding='utf-8')
        self.assertNotIn('fileData', state)
        self.assertNotIn('fileBytes', state)

    def test_신규_프로토콜_기기만_전송_ID_기능을_광고하고_기존_기기는_유지한다(self):
        status, modern = self.call('register', {'name': 'Modern', 'protocolVersion': 2})
        self.assertEqual(status, 200)
        legacy = self.session('Legacy')
        rows = self.call('peers', legacy)[1]['peers']
        self.assertEqual(rows[0], {'id': modern['id'], 'name': 'Modern', 'protocolVersion': 2})
        rows = self.call('peers', modern)[1]['peers']
        self.assertEqual(rows[0], {'id': legacy['id'], 'name': 'Legacy'})
        for invalid in ('2', 1, 3, True, None):
            self.assertEqual(self.call('register', {'name': 'Invalid', 'protocolVersion': invalid})[0], 400)

    def test_기기_설정은_기존_세션을_유지하고_주변_화면을_갱신한다(self):
        ipad = self.session('iPad')
        mac = self.session('Mac')
        status, _ = self.call('profile', {**ipad, 'name': 'iPad Pro', 'deviceType': 'tablet'})
        self.assertEqual(status, 200)
        self.assertEqual(self.call('heartbeat', ipad)[0], 200)
        status, peers = self.call('peers', mac)
        self.assertEqual(status, 200)
        self.assertEqual(peers['peers'], [
            {'id': ipad['id'], 'name': 'iPad Pro', 'deviceType': 'tablet'}
        ])
        # Changing the display does not rotate the session ID or token.
        with (Path(self.tmp) / f"{ipad['id']}.json").open(encoding='utf-8') as fp:
            stored = json.load(fp)
        self.assertEqual(stored['token'], ipad['token'])

    def test_기기_설정은_잘못된_종류와_토큰_및_긴_이름을_거부한다(self):
        session = self.session('Original')
        for bad in (None, '', 'router', '<svg>', 5):
            with self.subTest(device_type=bad):
                status, _ = self.call('profile', {
                    **session, 'name': 'Device', 'deviceType': bad
                })
                self.assertEqual(status, 400)
        status, _ = self.call('profile', {
            **session, 'name': 'z' * 49, 'deviceType': 'tablet'
        })
        self.assertEqual(status, 400)
        status, _ = self.call('profile', {
            **session, 'token': '0' * 48, 'name': 'Hacker', 'deviceType': 'tablet'
        })
        self.assertEqual(status, 403)
        with (Path(self.tmp) / f"{session['id']}.json").open(encoding='utf-8') as fp:
            stored = json.load(fp)
        self.assertEqual(stored['name'], 'Original')

    def test_초대_전에는_협상정보를_전달할_수_없다(self):
        a, b = self.session('A'), self.session('B')
        status, data = self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
            'body': {'sdp': {'type': 'offer', 'sdp': 'v=0\r\nhello-world'}}})
        self.assertEqual(status, 403)
        self.assertIn('approved', data['error'])

    def test_초대_없는_승인도_거부한다(self):
        a, b = self.session('A'), self.session('B')
        status, data = self.call('signal', {**b, 'to': a['id'], 'kind': 'accept', 'body': {}})
        self.assertEqual(status, 403)
        self.assertIn('pending invitation', data['error'])

    def test_승인전_초대_취소는_해당_수신자에게만_전달되고_승인을_차단한다(self):
        a, b, stranger = self.session('A'), self.session('B'), self.session('Stranger')
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'cancel.txt', 'size': 2}})[0], 200)
        self.assertEqual(self.call('signal', {**stranger, 'to': b['id'],
            'kind': 'bye', 'body': {}})[0], 403)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'],
            'kind': 'bye', 'body': {}})[0], 200)
        kinds = [message['kind'] for message in self.call('poll', b)[1]['messages']]
        self.assertEqual(kinds, ['invite', 'bye'])
        self.assertEqual(self.call('signal', {**b, 'to': a['id'],
            'kind': 'accept', 'body': {}})[0], 403)

    def test_수신_승인_이후에만_협상을_중개한다(self):
        a, b = self.session('A'), self.session('B')
        status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': '사진.jpg', 'size': 1234}})
        self.assertEqual(status, 200)
        status, data = self.call('poll', b)
        self.assertEqual(status, 200)
        self.assertEqual(data['messages'][0]['body']['name'], '사진.jpg')
        self.assertEqual(data['messages'][0]['from'], a['id'])
        self.assertEqual(self.call('poll', b)[1]['messages'], [])
        self.assertEqual(self.call('signal', {**b, 'to': a['id'], 'kind': 'accept', 'body': {}})[0], 200)
        self.assertEqual(self.call('poll', a)[1]['messages'][0]['kind'], 'accept')
        offer = {'sdp': {'type': 'offer', 'sdp': 'v=0\r\no=hello-world'}}
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'offer', 'body': offer})[0], 200)
        self.assertEqual(self.call('poll', b)[1]['messages'][0]['body'], offer)

    def test_수집된_ICE_후보가_포함된_SDP를_크기_제한_내에서_전달한다(self):
        a, b = self.session('Mac'), self.session('iPad')
        status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'sample.txt', 'size': 10}})
        self.assertEqual(status, 200)
        status, _ = self.call('signal', {**b, 'to': a['id'], 'kind': 'accept', 'body': {}})
        self.assertEqual(status, 200)
        sdp = 'v=0\r\n' + 'a' * 10500 + '\r\na=candidate:host'
        status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
            'body': {'sdp': {'type': 'offer', 'sdp': sdp}}})
        self.assertEqual(status, 200)
        status, queued = self.call('poll', b)
        self.assertEqual(status, 200)
        self.assertEqual(queued['messages'][-1]['body']['sdp']['sdp'], sdp)
        excessive = 'v=0\r\n' + 'a' * 12100
        status, result = self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
            'body': {'sdp': {'type': 'offer', 'sdp': excessive}}})
        self.assertEqual(status, 400)
        self.assertIn('invalid signal', result['error'])

    def test_ACK_폴링은_응답손실_메시지를_재전달하고_확인후_삭제한다(self):
        a, b = self.session('Mac'), self.session('iPad')
        first = 'a' * 24
        status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'requestId': first, 'body': {'name': 'photo.jpg', 'size': 10}})
        self.assertEqual(status, 200)
        status, reply = self.call('poll', {**b, 'acks': []})
        self.assertEqual(status, 200)
        self.assertEqual(reply['messages'][0]['id'], first)
        self.assertEqual(reply['messages'][0]['at'], self.time)
        # Simulate a lost browser response: without an ACK the queue remains.
        self.assertEqual(self.call('poll', {**b, 'acks': []})[1]['messages'], reply['messages'])
        self.assertEqual(self.call('poll', {**b, 'acks': [first]})[1]['messages'], [])
        self.assertEqual(self.call('poll', {**b, 'acks': [first]})[1]['messages'], [])

    def test_ACK_배치_중_확인한_메시지만_제거한다(self):
        a, b = self.session('Mac'), self.session('iPad')
        ids = ['a' * 24, 'b' * 24]
        for i in range(2):
            self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
                'requestId': ids[i], 'body': {'name': f'{i}.txt', 'size': 1}})[0], 200)
        status, payload = self.call('poll', {**b, 'acks': [ids[0]]})
        self.assertEqual(status, 200)
        self.assertEqual([m['id'] for m in payload['messages']], [ids[1]])
        self.assertEqual(self.call('poll', {**b, 'acks': []})[1]['messages'], payload['messages'])
        # Old clients keep the previous one-shot behavior for compatibility.
        self.assertEqual(len(self.call('poll', b)[1]['messages']), 1)
        self.assertEqual(self.call('poll', b)[1]['messages'], [])

    def test_ACK_및_요청ID_유효성_검사를_수행한다(self):
        a, b = self.session('Mac'), self.session('iPad')
        for bad in (None, 'bad', ['wrong'], ['a' * 24] * 33, [1], {}):
            with self.subTest(acks=bad):
                status, _ = self.call('poll', {**b, 'acks': bad})
                self.assertEqual(status, 400)
        for bad in (None, 'wrong', [], 123, 'g' * 24):
            with self.subTest(requestId=bad):
                status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
                    'requestId': bad, 'body': {'name': 'a.txt', 'size': 2}})
                self.assertEqual(status, 400)

    def test_응답손실_시_동일_요청ID_재전송을_중복등록하지_않는다(self):
        a, b = self.session('Mac'), self.session('iPad')
        rid = 'c' * 24
        invite = {**a, 'to': b['id'], 'kind': 'invite', 'requestId': rid,
            'body': {'name': 'a.txt', 'size': 2}}
        self.assertEqual(self.call('signal', invite)[0], 200)
        self.assertEqual(self.call('signal', invite)[0], 200)
        self.assertEqual(len(self.call('poll', {**b, 'acks': []})[1]['messages']), 1)
        # Even after the receiver consumed it, retry remains idempotent.
        self.assertEqual(self.call('poll', {**b, 'acks': [rid]})[1]['messages'], [])
        self.assertEqual(self.call('signal', invite)[0], 200)
        self.assertEqual(self.call('poll', {**b, 'acks': []})[1]['messages'], [])
        accept = {**b, 'to': a['id'], 'kind': 'accept', 'body': {}, 'requestId': 'd' * 24}
        self.assertEqual(self.call('signal', accept)[0], 200)
        self.assertEqual(self.call('signal', accept)[0], 200)
        self.assertEqual(len(self.call('poll', {**a, 'acks': []})[1]['messages']), 1)
        conflict = {**invite, 'kind': 'decline', 'body': {}}
        self.assertEqual(self.call('signal', conflict)[0], 409)
        changed_body = {**invite, 'body': {'name': 'changed.txt', 'size': 2}}
        self.assertEqual(self.call('signal', changed_body)[0], 409)

    def test_만료된_시그널링을_세션유지중_정리한다(self):
        a, b = self.session('Mac'), self.session('iPad')
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'a.txt', 'size': 2}})[0], 200)
        self.time += 38
        self.assertEqual(self.call('heartbeat', a)[0], 200)
        self.assertEqual(self.call('heartbeat', b)[0], 200)
        self.time += 8
        self.assertEqual(self.call('poll', {**b, 'acks': []})[1]['messages'], [])

    def test_중간_저장_중단후_동일_ID_재시도는_한번만_전달한다(self):
        a, b = self.session('A'), self.session('B')
        request = {**a, 'to': b['id'], 'kind': 'invite', 'requestId': 'e' * 24,
            'body': {'name': 'a.txt', 'size': 1}}
        with self.assertRaises(AssertionError):
            self.call('signal', request, env={'ARCDROP_TEST_CRASH_AFTER_FIRST': '1'})
        self.assertEqual(self.call('signal', request)[0], 200)
        self.assertEqual(self.call('signal', request)[0], 200)
        delivered = self.call('poll', {**b, 'acks': []})[1]['messages']
        self.assertEqual(len(delivered), 1)
        self.assertEqual(delivered[0]['id'], 'e' * 24)

    def test_전송_ID는_승인_권한과_지연_메시지를_독립적으로_검증한다(self):
        a, b = self.session('A'), self.session('B')
        first, second = '1' * 24, '2' * 24
        invite = {'name': 'alpha.txt', 'size': 5}
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'transferId': first, 'body': invite})[0], 200)
        received = self.call('poll', {**b, 'acks': []})[1]['messages']
        self.assertEqual(received[-1]['transferId'], first)
        self.assertEqual(self.call('signal', {**b, 'to': a['id'], 'kind': 'accept',
            'transferId': second, 'body': {}})[0], 403)
        self.assertEqual(self.call('signal', {**b, 'to': a['id'], 'kind': 'accept',
            'transferId': first, 'body': {}})[0], 200)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
            'transferId': first, 'body': {'sdp': {'type': 'offer', 'sdp': 'v=0\r\nTESTLONG'}}})[0], 200)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'transferId': second, 'body': invite})[0], 200)
        self.assertEqual(self.call('signal', {**b, 'to': a['id'], 'kind': 'accept',
            'transferId': second, 'body': {}})[0], 200)
        # The earlier transfer cannot cancel or send an SDP into the new scope.
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'bye',
            'transferId': first, 'body': {}})[0], 403)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
            'transferId': first, 'body': {'sdp': {'type': 'offer', 'sdp': 'v=0\r\nOLDLONG'}}})[0], 403)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'bye',
            'transferId': second, 'body': {}})[0], 200)

    def test_전송_ID_형식과_재시도_일관성을_검사한다(self):
        a, b = self.session('A'), self.session('B')
        invite = {**a, 'to': b['id'], 'kind': 'invite', 'body': {'name': 'a', 'size': 1}}
        for invalid in (None, '', 'A' * 24, 'x' * 24, 3):
            self.assertEqual(self.call('signal', {**invite, 'transferId': invalid})[0], 400)
        first = {**invite, 'transferId': 'a' * 24, 'requestId': 'd' * 24}
        self.assertEqual(self.call('signal', first)[0], 200)
        self.assertEqual(self.call('signal', first)[0], 200)
        self.assertEqual(self.call('signal', {**first, 'transferId': 'b' * 24})[0], 409)
        self.assertEqual(len(self.call('poll', {**b, 'acks': []})[1]['messages']), 1)

    def test_정리_주기에는_오래된_임시_파일만_제거한다(self):
        a = self.session('A')
        state = Path(self.tmp)
        names = [f"{a['id']}.json.tmp.123", '.cleanup.tmp.456', '.transaction.tmp.789']
        for name in names:
            p = state / name
            p.write_text('stale', encoding='utf-8')
            os.chmod(p, 0o600)
            os.utime(p, (1700000000, 1700000000))
        fresh = state / f"{a['id']}.json.tmp.999"
        fresh.write_text('fresh', encoding='utf-8')
        outside = state / 'unrelated.tmp.123'
        outside.write_text('keep', encoding='utf-8')
        attack = state / '.cleanup.tmp.000'
        attack.symlink_to(outside)
        self.time += 16
        self.assertEqual(self.call('heartbeat', a)[0], 200)
        self.assertTrue(fresh.exists() and outside.exists() and attack.is_symlink())
        for name in names:
            self.assertFalse((state / name).exists(), name)
        self.assertEqual(outside.read_text(encoding='utf-8'), 'keep')

    def test_CGI_응답에는_비식별_처리시간_계측을_포함한다(self):
        session = self.session('A')
        body = json.dumps(session).encode()
        env = dict(os.environ, REQUEST_METHOD='POST', QUERY_STRING='action=heartbeat',
            HTTPS='on', HTTP_ORIGIN='https://router.test', HTTP_HOST='router.test',
            CONTENT_TYPE='application/json', CONTENT_LENGTH=str(len(body)),
            REMOTE_ADDR='127.0.0.1', ARCDROP_TEST_STATE=self.tmp,
            ARCDROP_TEST_NOW=str(self.time))
        result = subprocess.run([str(BIN)], input=body, capture_output=True, env=env, check=True)
        headers = result.stdout.decode().split('\r\n\r\n', 1)[0]
        self.assertRegex(headers, r'Server-Timing: cgi;dur=\d+\.\d{3}, lock;dur=\d+\.\d{3}')
        self.assertNotIn(session['token'], headers)
        self.assertNotIn(session['id'], headers)

    def test_파일_본문_업로드는_허용하지_않는다(self):
        a, b = self.session('A'), self.session('B')
        for kind, body in [('file', {'data': 'c29tZSBieXRlcw=='}),
                           ('invite', {'name': 'test', 'size': 1, 'chunk': 'bytes'}),
                           ('candidate', {'chunk': 'bytes'}),
                           ('accept', {'bytes': 'secret'})]:
            with self.subTest(kind=kind):
                status, _ = self.call('signal', {**a, 'to': b['id'], 'kind': kind, 'body': body})
                self.assertEqual(status, 400)
        for item in Path(self.tmp).iterdir():
            if item.name.endswith('.json'):
                self.assertNotIn('c29tZSBieXRlcw==', item.read_text())
        self.assertFalse(list(Path(self.tmp).rglob('*.bin')))

    def test_비활성_기기는_자동으로_정리한다(self):
        a = self.session('A')
        self.time += 46
        status, _ = self.call('poll', a)
        self.assertEqual(status, 403)
        self.assertFalse((Path(self.tmp) / (a['id'] + '.json')).exists())

    def test_세션_종료와_개수_제한을_지킨다(self):
        ids = [self.session('A') for _ in range(4)]
        status, _ = self.call('register', {'name': 'fifth'})
        self.assertEqual(status, 429)
        self.assertEqual(self.call('leave', ids[0])[0], 200)
        status, _ = self.call('register', {'name': 'replacement'})
        self.assertEqual(status, 200)

    def test_신호와_요청_크기를_제한한다(self):
        a, b = self.session('A'), self.session('B')
        status, data = self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'x', 'size': 70000000}})
        self.assertEqual(status, 400)
        status, _ = self.call('register', {'name': 'x' * 16000})
        self.assertEqual(status, 400)
        status, _ = self.call('register', raw=b'not-json')
        self.assertEqual(status, 400)

    def test_긴_잠금경로가_잘려_다른_파일을_잠그지_않는다(self):
        # A 320-byte lock buffer previously truncated a long state path.
        # Make the truncated path an existing private file to prove that
        # a request cannot silently lock the wrong file.
        with tempfile.TemporaryDirectory(prefix='arcdrop-lock-path-') as directory:
            parent = Path(directory) / ('p' * 120)
            parent.mkdir(mode=0o700)
            prefix_len = 319 - len(str(parent)) - 1
            self.assertTrue(1 <= prefix_len <= 253)
            prefix = 'q' * prefix_len
            protected = parent / prefix
            protected.write_text('untouched', encoding='utf-8')
            os.chmod(protected, 0o600)
            state = parent / (prefix + 'r')
            state.mkdir(mode=0o700)
            status, reply = self.call('register', {'name': 'A'},
                env={'ARCDROP_TEST_STATE': str(state)})
            self.assertEqual(status, 503)
            self.assertEqual(reply['error'], 'state lock unavailable')
            self.assertEqual(protected.read_text(encoding='utf-8'), 'untouched')
            self.assertFalse((state / '.lock').exists())

    def test_잠금파일_심볼릭링크를_거부하고_외부파일을_보존한다(self):
        with tempfile.TemporaryDirectory(prefix='arcdrop-guard-test-') as outside:
            target = Path(outside) / 'do-not-touch'
            target.write_text('protected', encoding='utf-8')
            (Path(self.tmp) / '.lock').symlink_to(target)
            status, result = self.call('register', {'name': 'attacker'})
            self.assertEqual(status, 503)
            self.assertIn('lock', result['error'])
            self.assertEqual(target.read_text(encoding='utf-8'), 'protected')

    def test_상태_디렉터리와_잠금_파일의_권한을_확인한다(self):
        os.chmod(self.tmp, 0o711)
        status, data = self.call('register', {'name': 'A'})
        self.assertEqual(status, 503)
        self.assertIn('state directory', data['error'])
        os.chmod(self.tmp, 0o700)
        lock_path = Path(self.tmp) / '.lock'
        lock_path.write_text('', encoding='utf-8')
        os.chmod(lock_path, 0o644)
        status, data = self.call('register', {'name': 'A'})
        self.assertEqual(status, 503)
        self.assertIn('lock', data['error'])

    def test_세션_파일_심볼릭링크를_거부하고_외부_파일을_보호한다(self):
        a = self.session('A')
        path = Path(self.tmp) / f"{a['id']}.json"
        with tempfile.TemporaryDirectory(prefix='arc-safe-') as outside:
            target = Path(outside) / 'untouched.json'
            target.write_text('keep me', encoding='utf-8')
            path.unlink()
            path.symlink_to(target)
            status, data = self.call('heartbeat', a)
            self.assertEqual(status, 403)
            self.assertEqual(data['error'], 'invalid or expired session')
            self.assertEqual(target.read_text(encoding='utf-8'), 'keep me')

    def test_권한이_열려있거나_큰_세션파일을_거부한다(self):
        a = self.session('A')
        path = Path(self.tmp) / f"{a['id']}.json"
        os.chmod(path, 0o644)
        self.assertEqual(self.call('heartbeat', a)[0], 403)
        os.chmod(path, 0o600)
        path.write_text('{"data":"' + 'X' * (97 * 1024) + '"}', encoding='utf-8')
        self.assertEqual(self.call('heartbeat', a)[0], 403)

    def test_다른_기기_ID를_사칭하는_세션파일을_거부한다(self):
        a = self.session('A')
        path = Path(self.tmp) / f"{a['id']}.json"
        data = json.loads(path.read_text(encoding='utf-8'))
        data['id'] = 'b' * 24 if a['id'] != 'b' * 24 else 'a' * 24
        path.write_text(json.dumps(data), encoding='utf-8')
        self.assertEqual(self.call('heartbeat', a)[0], 403)

    def test_시그널링_큐는_메시지_개수뿐_아니라_누적_바이트도_제한한다(self):
        a, b = self.session('A'), self.session('B')
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'file', 'size': 1024}})[0], 200)
        self.assertEqual(self.call('signal', {**b, 'to': a['id'], 'kind': 'accept',
            'body': {}})[0], 200)
        self.assertEqual(self.call('poll', b)[0], 200)
        failed = False
        for index in range(9):
            sdp = 'v=0\r\n' + 'X' * 10200 + str(index)
            status, data = self.call('signal', {**a, 'to': b['id'], 'kind': 'offer',
                'body': {'sdp': {'type': 'offer', 'sdp': sdp}}})
            if status == 429:
                self.assertEqual(data['error'], 'recipient signal queue is full')
                failed = True
                break
            self.assertEqual(status, 200)
        self.assertTrue(failed, '많은 SDP의 총합이 큐 상한을 넘어야 합니다')
        path = Path(self.tmp) / f"{b['id']}.json"
        stored = json.loads(path.read_text(encoding='utf-8'))
        encoded = json.dumps(stored['messages'], ensure_ascii=False, separators=(',', ':'))
        self.assertLessEqual(len(encoded.encode('utf-8')), 64 * 1024)
        self.assertLessEqual(len(stored['messages']), 32)

    def test_세션_전체_정리는_일정_시간_후에만_수행된다(self):
        a = self.session('A')
        stale = Path(self.tmp) / ('a' * 24 + '.json')
        stale.write_text(json.dumps({'id': 'a' * 24, 'last': self.time - 100}), encoding='utf-8')
        self.assertEqual(self.call('heartbeat', a)[0], 200)
        self.assertTrue(stale.exists())
        self.time += 14
        self.assertEqual(self.call('heartbeat', a)[0], 200)
        self.assertTrue(stale.exists())
        self.time += 1
        self.assertEqual(self.call('heartbeat', a)[0], 200)
        self.assertFalse(stale.exists())

    def test_두_기기_저장_실패는_기존_상태로_되돌린다(self):
        a, b = self.session('A'), self.session('B')
        signal = {**a, 'to': b['id'], 'kind': 'invite', 'body': {'name': 'test', 'size': 1}}
        status, result = self.call('signal', signal,
            env={'ARCDROP_TEST_FAIL_AFTER_FIRST': '1'})
        self.assertEqual(status, 503)
        self.assertEqual(result['error'], 'state unavailable')
        self.assertFalse((Path(self.tmp) / '.transaction').exists())
        self.assertEqual(self.call('poll', b)[1]['messages'], [])
        self.assertEqual(self.call('signal', {**b, 'to': a['id'],
            'kind': 'accept', 'body': {}})[0], 403)
        self.assertEqual(self.call('signal', signal)[0], 200)
        self.assertEqual(len(self.call('poll', b)[1]['messages']), 1)

    def test_두_기기_저장_도중_프로세스가_죽으면_다음_요청에서_복구한다(self):
        a, b = self.session('A'), self.session('B')
        signal = {**a, 'to': b['id'], 'kind': 'invite', 'body': {'name': 'test', 'size': 1}}
        with self.assertRaises(AssertionError):
            self.call('signal', signal, env={'ARCDROP_TEST_CRASH_AFTER_FIRST': '1'})
        self.assertTrue((Path(self.tmp) / '.transaction').exists())
        self.assertEqual(self.call('poll', b)[1]['messages'], [])
        self.assertFalse((Path(self.tmp) / '.transaction').exists())
        self.assertEqual(self.call('signal', {**b, 'to': a['id'],
            'kind': 'accept', 'body': {}})[0], 403)
        self.assertEqual(self.call('signal', signal)[0], 200)

    def test_수신_승인_저장_도중_중단되어도_양측_권한이_복구된다(self):
        a, b = self.session('A'), self.session('B')
        self.assertEqual(self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'test', 'size': 1}})[0], 200)
        self.assertEqual(self.call('poll', b)[0], 200)
        accept = {**b, 'to': a['id'], 'kind': 'accept', 'body': {}}
        with self.assertRaises(AssertionError):
            self.call('signal', accept, env={'ARCDROP_TEST_CRASH_AFTER_FIRST': '1'})
        self.assertTrue((Path(self.tmp) / '.transaction').exists())
        self.assertEqual(self.call('poll', a)[1]['messages'], [])
        self.assertFalse((Path(self.tmp) / '.transaction').exists())
        offer = {'sdp': {'type': 'offer', 'sdp': 'v=0\r\nhello-world'}}
        status, result = self.call('signal', {**a, 'to': b['id'],
            'kind': 'offer', 'body': offer})
        self.assertEqual(status, 403)
        self.assertIn('approved', result['error'])
        self.assertEqual(self.call('signal', accept)[0], 200)
        self.assertEqual(self.call('signal', {**a, 'to': b['id'],
            'kind': 'offer', 'body': offer})[0], 200)

    def test_손상된_저널은_거부하고_외부_파일을_변경하지_않는다(self):
        with tempfile.TemporaryDirectory(prefix='arc-journal-') as outside:
            target = Path(outside) / 'untouched'
            target.write_text('protected', encoding='utf-8')
            (Path(self.tmp) / '.transaction').symlink_to(target)
            status, data = self.call('register', {'name': 'A'})
            self.assertEqual(status, 503)
            self.assertEqual(data['error'], 'state recovery unavailable')
            self.assertEqual(target.read_text(encoding='utf-8'), 'protected')

    def test_다운로드_저장소는_생기지_않는다(self):
        a, b = self.session('A'), self.session('B')
        self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'sample.txt', 'size': 5}})
        all_files = list(Path(self.tmp).iterdir())
        self.assertEqual(sum(f.is_file() and f.name.endswith('.json') for f in all_files), 2)
        self.assertTrue(all(f.name in ('.lock', '.cleanup') or f.name.endswith('.json') for f in all_files))


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
