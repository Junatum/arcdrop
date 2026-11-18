"""Host CGI concurrency probe regressions; no router metrics are claimed."""
# SPDX-License-Identifier: GPL-3.0-or-later
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / 'tools'
sys.path.insert(0, str(TOOLS))
from bench_cgi import percentile, summarize  # noqa: E402


class ArcDropLoadTests(unittest.TestCase):
    def test_지연시간_요약은_소량의_표본에도_정상적으로_동작한다(self):
        self.assertEqual(percentile([3, 1, 2], 95), 3)
        self.assertEqual(percentile([3, 1, 2], 50), 2)
        self.assertEqual(summarize([(5.0, 3.0, 6.0, 200)] * 3)['errors'], 0)
        self.assertEqual(summarize([(5.0, 3.0, 6.0, 429)])['errors'], 1)
        with self.assertRaises(ValueError):
            percentile([], 95)

    def test_실제_CGI를_2_6_12기기로_동시_폴링하고_계측한다(self):
        result = subprocess.run([sys.executable, str(TOOLS / 'bench_cgi.py'),
                                 '--clients', '2,6,12', '--polls', '2'],
                                capture_output=True, text=True, timeout=45, check=True)
        data = json.loads(result.stdout)
        self.assertEqual(data['environment'], 'HOST_TEST_ONLY_NOT_ROUTER')
        self.assertEqual(set(data['scenarios']), {'2', '6', '12'})
        for clients, entry in data['scenarios'].items():
            self.assertEqual(entry['requests'], 2 * int(clients))
            self.assertEqual(entry['errors'], 0)
            self.assertGreaterEqual(entry['cgi_ms_p95'], 0)
            self.assertGreaterEqual(entry['lock_ms_p95'], 0)
        self.assertNotIn('token', result.stdout)
        self.assertNotIn('127.0.0.', result.stdout)

    def test_가상_기기_개수_초과는_실행전에_거부한다(self):
        result = subprocess.run([sys.executable, str(TOOLS / 'bench_cgi.py'),
                                 '--clients', '25', '--polls', '2'],
                                capture_output=True, text=True, timeout=10, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must be unique', result.stderr)


if __name__ == '__main__':
    unittest.main(testRunner=unittest.TextTestRunner(stream=sys.stdout, verbosity=2))
