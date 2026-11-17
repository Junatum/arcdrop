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
        source = (ROOT / 'src/arcdrop.c').read_text(encoding='utf-8')
        self.assertIn('#include <sys/file.h>', source)
        self.assertIn('O_CLOEXEC | O_NOFOLLOW', source)
        feature_prefix = source.split('#include <arpa/inet.h>', 1)[0]
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
        subprocess.run([
            'cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
            '-DARCDROP_TEST', str(ROOT / 'src/arcdrop.c'), '-o', str(BIN),
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

    def test_잠금파일_심볼릭링크를_거부하고_외부파일을_보존한다(self):
        with tempfile.TemporaryDirectory(prefix='arcdrop-guard-test-') as outside:
            target = Path(outside) / 'do-not-touch'
            target.write_text('protected', encoding='utf-8')
            (Path(self.tmp) / '.lock').symlink_to(target)
            status, result = self.call('register', {'name': 'attacker'})
            self.assertEqual(status, 503)
            self.assertIn('lock', result['error'])
            self.assertEqual(target.read_text(encoding='utf-8'), 'protected')

    def test_다운로드_저장소는_생기지_않는다(self):
        a, b = self.session('A'), self.session('B')
        self.call('signal', {**a, 'to': b['id'], 'kind': 'invite',
            'body': {'name': 'sample.txt', 'size': 5}})
        all_files = list(Path(self.tmp).iterdir())
        self.assertEqual(sum(f.is_file() and f.name.endswith('.json') for f in all_files), 2)
        self.assertTrue(all(f.name == '.lock' or f.name.endswith('.json') for f in all_files))


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
