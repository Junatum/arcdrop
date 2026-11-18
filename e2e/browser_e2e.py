"""Optional real-browser ArcDrop P2P tests (macOS/Linux/Windows Chromium).

Run: python3 e2e/browser_e2e.py
Requires: Playwright, OpenSSL, a C compiler, json-c and a browser binary.
For WebKit: ARCDROP_E2E_BROWSER=webkit python3 e2e/browser_e2e.py
No external network, cloud backend, STUN/TURN or production TLS modifications.
"""
# SPDX-License-Identifier: GPL-3.0-or-later
import hashlib
import mimetypes
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_cgi import json_c_build_flags  # noqa: E402 -- reuse tested macOS/Linux flags


def browser_options(browser_kind, env=None):
    """Return a usable local browser path; otherwise use Playwright's installed browser."""
    env = env if env is not None else os.environ
    custom = env.get('ARCDROP_E2E_BROWSER_PATH')
    if custom:
        if not Path(custom).is_file():
            raise RuntimeError(f'ARCDROP_E2E_BROWSER_PATH does not exist: {custom}')
        return {'executable_path': custom}
    if browser_kind != 'chromium':
        return {}
    candidates = [
        shutil.which('chromium'), shutil.which('chromium-browser'),
        shutil.which('google-chrome'), shutil.which('google-chrome-stable'),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return {'executable_path': str(candidate)}
    return {}


def local_certificate(directory):
    """OpenSSL config works on macOS LibreSSL as well as OpenSSL 3.x."""
    config = directory / 'openssl.cnf'
    config.write_text('''[req]
prompt = no
distinguished_name = name
x509_extensions = ext
[name]
CN = localhost
[ext]
subjectAltName = DNS:localhost,IP:127.0.0.1
basicConstraints = CA:FALSE
''', encoding='utf-8')
    cert, key = directory / 'cert.pem', directory / 'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                    '-keyout', str(key), '-out', str(cert), '-config', str(config),
                    '-days', '1'], stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL, check=True)
    return cert, key


def build_test_cgi(directory):
    binary = directory / 'arcdrop'
    subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
                    '-DARCDROP_TEST', *[str(p) for p in sorted((ROOT / 'src').glob('*.c'))], '-o', str(binary),
                    *json_c_build_flags()], check=True)
    return binary


class RouterHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        name = 'index.html' if self.path in ('/arcdrop', '/arcdrop/') else self.path.removeprefix('/arcdrop/')
        if self.path not in ('/arcdrop', '/arcdrop/') and not self.path.startswith('/arcdrop/'):
            self.send_error(404)
            return
        allowed = ('index.html', 'app.js', 'style.css', 'icon.svg')
        modules = ('core.js', 'api.js', 'ui.js', 'discovery.js', 'transfer.js', 'signaling.js', 'session.js')
        if name not in allowed and name not in (f'js/{module}' for module in modules):
            self.send_error(404)
            return
        data = (ROOT / 'web' / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'text/plain')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.path.startswith('/cgi-bin/arcdrop?action='):
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 < length <= 16384:
            self.send_error(400)
            return
        data = self.rfile.read(length)
        env = dict(os.environ,
            REQUEST_METHOD='POST', QUERY_STRING=self.path.split('?', 1)[1], HTTPS='on',
            HTTP_ORIGIN=self.headers.get('Origin', ''), HTTP_HOST=self.headers.get('Host', ''),
            CONTENT_TYPE=self.headers.get('Content-Type', ''), CONTENT_LENGTH=str(len(data)),
            REMOTE_ADDR='127.0.0.1', ARCDROP_TEST_MODE='1', ARCDROP_TEST_STATE=self.server.state_dir)
        result = subprocess.run([self.server.bin_path], input=data,
                                capture_output=True, env=env, timeout=10)
        if result.returncode or b'\r\n\r\n' not in result.stdout:
            self.send_error(500)
            return
        header, body = result.stdout.split(b'\r\n\r\n', 1)
        code = int(header.split(b' ')[1])
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ArcDropBrowserTests(unittest.TestCase):
    def test_양방향_빈파일_거절_취소_복구와_파일_미저장을_검증한다(self):
        with tempfile.TemporaryDirectory(prefix='arcdrop-e2e-') as tmp:
            directory = Path(tmp)
            os.chmod(directory, 0o700)
            cert, key = local_certificate(directory)
            binary = build_test_cgi(directory)
            server = ThreadingHTTPServer(('127.0.0.1', 0), RouterHTTPHandler)
            server.state_dir = str(directory / 'sessions')
            server.bin_path = str(binary)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(str(cert), str(key))
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'https://localhost:{server.server_port}/arcdrop/'
                with sync_playwright() as playwright:
                    kind = os.environ.get('ARCDROP_E2E_BROWSER', 'chromium')
                    if kind not in ('chromium', 'firefox', 'webkit'):
                        raise RuntimeError('ARCDROP_E2E_BROWSER must be chromium, firefox or webkit')
                    browser_type = getattr(playwright, kind)
                    options = browser_options(kind)
                    try:
                        browser = browser_type.launch(headless=True, **options)
                    except Exception as error:
                        raise RuntimeError(
                            f'Unable to launch {kind}. Run: python3 -m playwright install {kind}; '
                            'or set ARCDROP_E2E_BROWSER_PATH. Original error: '
                            f'{error}'
                        ) from error
                    try:
                        contexts = [browser.new_context(ignore_https_errors=True, accept_downloads=True)
                                    for _ in range(2)]
                        a, b = [context.new_page() for context in contexts]
                        page_errors = []
                        for page in (a, b):
                            page.on('pageerror', lambda err: page_errors.append(str(err)))
                            page.goto(url, timeout=20000)
                            page.locator('#connection-label').get_by_text('로컬 연결').wait_for(timeout=20000)
                        a.locator('.peer').first.wait_for(timeout=22000)
                        b.locator('.peer').first.wait_for(timeout=22000)

                        def send(sender, receiver, name, payload):
                            with sender.expect_file_chooser() as chooser:
                                sender.locator('.peer').first.click()
                            if isinstance(payload, Path):
                                chooser.value.set_files(str(payload))
                            else:
                                chooser.value.set_files({'name': name, 'mimeType': 'application/octet-stream',
                                                         'buffer': payload})
                            receiver.locator('#incoming:not(.hidden)').wait_for(timeout=20000)
                            receiver.locator('#accept').click()
                            receiver.locator('#download:not(.hidden)').wait_for(timeout=90000 if isinstance(payload, Path) else 45000)
                            with receiver.expect_download() as info:
                                receiver.locator('#download-link').click()
                            received = directory / f'received-{name}'
                            info.value.save_as(received)
                            self.assertEqual(info.value.suggested_filename, name)
                            if isinstance(payload, Path):
                                self.assertEqual(received.stat().st_size, payload.stat().st_size)
                                with payload.open('rb') as source, received.open('rb') as actual:
                                    def digest(file):
                                        h = hashlib.sha256()
                                        for block in iter(lambda: file.read(1024 * 1024), b''):
                                            h.update(block)
                                        return h.digest()
                                    self.assertEqual(digest(actual), digest(source))
                            else:
                                self.assertEqual(received.read_bytes(), payload)
                            receiver.locator('#done').click()
                            sender.locator('#transfer.hidden').wait_for(timeout=15000)
                            # The receiver releases its WebRTC connection 800ms after ACK.
                            # Wait for the real UI to become selectable before reversing roles.
                            receiver.wait_for_function(
                                "() => document.querySelector('.peer')?.disabled === false",
                                timeout=10000)

                        send(a, b, 'a-to-b.txt', b'ArcDrop forward LAN P2P transfer')
                        send(b, a, 'b-to-a.txt', b'ArcDrop reverse LAN P2P transfer')
                        send(a, b, 'empty.txt', b'')
                        with a.expect_file_chooser() as chooser:
                            a.locator('.peer').first.click()
                        chooser.value.set_files({'name': 'declined.txt', 'mimeType': 'text/plain',
                                                 'buffer': b'REJECT THIS'})
                        b.locator('#incoming:not(.hidden)').wait_for(timeout=20000)
                        b.locator('#decline').click()
                        a.locator('#transfer.hidden').wait_for(timeout=15000)
                        # Sender cancels while the receiver still has the consent dialog.
                        with a.expect_file_chooser() as chooser:
                            a.locator('.peer').first.click()
                        chooser.value.set_files({'name': 'cancel.txt', 'mimeType': 'text/plain',
                                                 'buffer': b'CANCEL THIS'})
                        b.locator('#incoming:not(.hidden)').wait_for(timeout=20000)
                        a.locator('#cancel').click()
                        a.locator('#transfer.hidden').wait_for(timeout=10000)
                        b.locator('#incoming.hidden').wait_for(timeout=20000)
                        # A tab reload must restore its session and peer discovery.
                        a.reload(timeout=20000)
                        a.locator('#connection-label').get_by_text('로컬 연결').wait_for(timeout=20000)
                        a.locator('.peer').first.wait_for(timeout=22000)
                        if os.environ.get('ARCDROP_E2E_LARGE', '').lower() in ('1', 'true', 'yes'):
                            # Opt-in boundary check, never enabled in fast PR smoke.
                            large_file = directory / 'boundary-64MiB.bin'
                            with large_file.open('wb') as output:
                                block = bytes(range(256)) * 4096
                                for _ in range(64):
                                    output.write(block)
                            send(a, b, large_file.name, large_file)
                        self.assertEqual(page_errors, [], page_errors)
                        # The router's CGI state contains signaling metadata, never any bytes.
                        for record in (directory / 'sessions').glob('*.json'):
                            content = record.read_bytes()
                            self.assertNotIn(b'ArcDrop forward LAN P2P transfer', content)
                            self.assertNotIn(b'ArcDrop reverse LAN P2P transfer', content)
                            self.assertNotIn(b'REJECT THIS', content)
                            self.assertNotIn(b'CANCEL THIS', content)
                    finally:
                        browser.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
