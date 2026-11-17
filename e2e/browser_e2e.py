"""Optional real-browser WebRTC end-to-end test (desktop Chromium + Playwright).

Run: python3 e2e/browser_e2e.py
Requires a dev machine with openssl and playwright; never needed on the router.
"""
import json
import mimetypes
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


class RouterHTTPHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/arcdrop', '/arcdrop/'):
            name = 'index.html'
        else:
            name = self.path.removeprefix('/arcdrop/')
        if name not in ('app.js', 'index.html', 'style.css'):
            self.send_error(404)
            return
        data = (ROOT / 'web' / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mimetypes.guess_type(name)[0] or 'text/plain')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if not self.path.startswith('/cgi-bin/arcdrop?action='):
            self.send_error(404)
            return
        data = self.rfile.read(int(self.headers.get('Content-Length', '0')))
        env = dict(os.environ,
            REQUEST_METHOD='POST', QUERY_STRING=self.path.split('?', 1)[1], HTTPS='on',
            HTTP_ORIGIN=self.headers.get('Origin', ''), HTTP_HOST=self.headers.get('Host', ''),
            CONTENT_TYPE=self.headers.get('Content-Type', ''), CONTENT_LENGTH=str(len(data)),
            REMOTE_ADDR='127.0.0.1', ARCDROP_TEST_MODE='1', ARCDROP_TEST_STATE=self.server.state_dir)
        p = subprocess.run([self.server.bin_path], input=data, capture_output=True, env=env)
        if p.returncode:
            self.send_error(500)
            return
        header, body = p.stdout.split(b'\r\n\r\n', 1)
        code = int(header.split(b' ')[1])
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class ArcDropBrowserTests(unittest.TestCase):
    def test_두_브라우저가_파일을_직접_전송한다(self):
        with tempfile.TemporaryDirectory(prefix='arcdrop-e2e-') as tmp:
            os.chmod(tmp, 0o700)
            cert, key = Path(tmp) / 'cert.pem', Path(tmp) / 'key.pem'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                '-keyout', str(key), '-out', str(cert), '-subj', '/CN=localhost',
                '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-days', '1'],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            bin_path = Path(tmp) / 'arcdrop'
            subprocess.run(['cc', '-std=c11', '-O2', '-DARCDROP_TEST', str(ROOT / 'src/arcdrop.c'),
                '-o', str(bin_path), '-ljson-c'], check=True)
            server = ThreadingHTTPServer(('127.0.0.1', 0), RouterHTTPHandler)
            server.state_dir = str(Path(tmp) / 'sessions')
            server.bin_path = str(bin_path)
            tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            tls.load_cert_chain(str(cert), str(key))
            server.socket = tls.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f'https://localhost:{server.server_port}/arcdrop/'
                with sync_playwright() as playwright:
                    browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', headless=True,
                        args=['--no-sandbox', '--disable-dev-shm-usage'])
                    a = browser.new_context(ignore_https_errors=True, accept_downloads=True)
                    b = browser.new_context(ignore_https_errors=True, accept_downloads=True)
                    sender, receiver = a.new_page(), b.new_page()
                    failures = []
                    sender.on('pageerror', lambda error: failures.append(str(error)))
                    receiver.on('pageerror', lambda error: failures.append(str(error)))
                    sender.goto(url)
                    receiver.goto(url)
                    sender.locator('.peer').first.wait_for(timeout=15000)
                    receiver.locator('.peer').first.wait_for(timeout=15000)
                    sample = b'ArcDrop direct transfer test!'
                    with sender.expect_file_chooser() as chooser:
                        sender.locator('.peer').first.click()
                    chooser.value.set_files({'name': 'arcdrop.txt',
                        'mimeType': 'text/plain', 'buffer': sample})
                    receiver.locator('#incoming').wait_for(timeout=15000)
                    receiver.locator('#accept').click()
                    receiver.locator('#download').wait_for(timeout=30000)
                    with receiver.expect_download() as info:
                        receiver.locator('#download-link').click()
                    result = info.value
                    target = Path(tmp) / 'downloaded.txt'
                    result.save_as(target)
                    self.assertEqual(result.suggested_filename, 'arcdrop.txt')
                    self.assertEqual(target.read_bytes(), sample)
                    self.assertEqual(failures, [])
                    browser.close()
            finally:
                server.shutdown()
                server.server_close()
                thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main(verbosity=2)
