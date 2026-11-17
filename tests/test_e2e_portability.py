"""E2E runner portability contracts without requiring Playwright in regular CI."""
# SPDX-License-Identifier: GPL-3.0-or-later
import ast
from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / 'e2e/browser_e2e.py').read_text(encoding='utf-8')
TREE = ast.parse(SOURCE)
FUNCTIONS = {node.name: node for node in TREE.body if isinstance(node, ast.FunctionDef)}


def load_helper(name):
    module = ast.Module(body=[FUNCTIONS[name]], type_ignores=[])
    scope = {'Path': Path, 'os': os, 'shutil': shutil, 'subprocess': subprocess}
    exec(compile(module, '<e2e helper>', 'exec'), scope)
    return scope[name]


class ArcDropE2EPortabilityTests(unittest.TestCase):
    def test_브라우저_실행_경로는_맥과_리눅스에서_탐지한다(self):
        options = load_helper('browser_options')
        with tempfile.TemporaryDirectory(prefix='arc-e2e-test-') as tmp:
            fake = Path(tmp) / 'chrome'
            fake.touch()
            self.assertEqual(options('chromium', {'ARCDROP_E2E_BROWSER_PATH': str(fake)}),
                             {'executable_path': str(fake)})
            with self.assertRaisesRegex(RuntimeError, 'does not exist'):
                options('chromium', {'ARCDROP_E2E_BROWSER_PATH': str(fake) + '-missing'})
        self.assertIn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', SOURCE)
        self.assertIn("shutil.which('chromium')", SOURCE)
        self.assertNotIn("executable_path='/usr/bin/chromium'", SOURCE)
        self.assertEqual(options('webkit', {}), {})

    def test_맥의_LibreSSL에서도_임시_인증서를_생성할_수_있다(self):
        issue = load_helper('local_certificate')
        with tempfile.TemporaryDirectory(prefix='arc-cert-test-') as tmp:
            directory = Path(tmp)
            cert, key = issue(directory)
            self.assertTrue(cert.is_file() and key.is_file())
            result = subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-text'],
                                    check=True, text=True, capture_output=True)
            self.assertIn('DNS:localhost', result.stdout)
            self.assertIn('IP Address:127.0.0.1', result.stdout)
            self.assertNotIn("'-addext'", SOURCE)

    def test_브라우저_E2E는_선택형이며_아티팩트를_업로드하지_않는다(self):
        workflow = (ROOT / '.github/workflows/browser-e2e.yml').read_text(encoding='utf-8')
        self.assertIn('workflow_dispatch:', workflow)
        self.assertIn('ARCDROP_E2E_BROWSER:', workflow)
        self.assertIn('python3 e2e/browser_e2e.py', workflow)
        self.assertIn('macos-15', workflow)
        self.assertIn('ubuntu-24.04', workflow)
        self.assertNotIn('upload-artifact', workflow)
        self.assertNotIn('push:', workflow)
        self.assertNotIn('pull_request:', workflow)

    def test_브라우저_E2E는_운영_모듈만_제공하고_데모를_차단한다(self):
        self.assertIn("modules = ('core.js', 'api.js', 'ui.js'", SOURCE)
        self.assertIn("name not in (f'js/{module}' for module in modules)", SOURCE)
        self.assertIn('self.send_error(404)', SOURCE)
        self.assertIn("mimetypes.guess_type(name)", SOURCE)
        for name in ('core', 'api', 'ui', 'discovery', 'transfer', 'signaling', 'session'):
            self.assertTrue((ROOT / f'web/js/{name}.js').is_file())
        self.assertNotIn("'demo.js', 'style.css'", SOURCE)

    def test_실제_브라우저_테스트는_양방향과_거절_파일_미저장을_검증한다(self):
        self.assertIn('send(a, b,', SOURCE)
        self.assertIn('send(b, a,', SOURCE)
        self.assertIn("receiver.locator('#accept').click()", SOURCE)
        self.assertIn("b.locator('#decline').click()", SOURCE)
        self.assertIn('self.assertNotIn(b\'ArcDrop forward LAN P2P transfer\'', SOURCE)
        self.assertIn("'icon.svg'", SOURCE)
        self.assertIn("'ARCDROP_E2E_BROWSER'", SOURCE)
        self.assertIn('ignore_https_errors=True', SOURCE)
        self.assertIn("REMOTE_ADDR='127.0.0.1'", SOURCE)


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
