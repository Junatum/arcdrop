#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Host-only concurrency benchmark of the real ArcDrop CGI (not router metrics).

Compiles with ARCDROP_TEST, runs against an isolated temporary state directory,
prints only aggregate timings. Session tokens/peer IDs never enter output files.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tests'))
from test_cgi import json_c_build_flags  # noqa: E402

TIMING = re.compile(rb'Server-Timing:\s*cgi;dur=([0-9.]+),\s*lock;dur=([0-9.]+)', re.I)


def percentile(values, pct):
    """Nearest-rank percentile for a small, explicitly bounded sample."""
    if not values:
        raise ValueError('Cannot compute percentile of an empty sample')
    ordered = sorted(values)
    return round(ordered[max(0, (len(ordered) * pct + 99) // 100 - 1)], 3)


def summarize(samples):
    """Summaries omit request, response, token and IP details."""
    cgi = [s[0] for s in samples]
    lock = [s[1] for s in samples]
    wall = [s[2] for s in samples]
    return {
        'requests': len(samples), 'errors': sum(1 for sample in samples if sample[3] != 200),
        'cgi_ms_p50': percentile(cgi, 50), 'cgi_ms_p95': percentile(cgi, 95),
        'lock_ms_p95': percentile(lock, 95), 'wall_ms_p95': percentile(wall, 95),
        'cgi_ms_max': round(max(cgi), 3),
    }


def compile_cgi(directory):
    binary = directory / 'arcdrop'
    subprocess.run(['cc', '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror',
                    '-DARCDROP_TEST', *[str(p) for p in sorted((ROOT / 'src').glob('*.c'))],
                    '-o', str(binary), *json_c_build_flags()], check=True)
    return binary


def request(binary, state_dir, remote_ip, action, body):
    data = json.dumps(body, separators=(',', ':')).encode('utf-8')
    env = dict(os.environ, REQUEST_METHOD='POST', QUERY_STRING='action=' + action,
               HTTPS='on', HTTP_ORIGIN='https://localhost', HTTP_HOST='localhost',
               CONTENT_TYPE='application/json', CONTENT_LENGTH=str(len(data)),
               REMOTE_ADDR=remote_ip, ARCDROP_TEST_MODE='1', ARCDROP_TEST_STATE=str(state_dir))
    started = time.perf_counter()
    proc = subprocess.run([str(binary)], input=data, capture_output=True, env=env, timeout=10)
    wall_ms = (time.perf_counter() - started) * 1000
    if proc.returncode != 0 or b'\r\n\r\n' not in proc.stdout:
        raise RuntimeError('CGI process failed or returned invalid HTTP response')
    head, payload = proc.stdout.split(b'\r\n\r\n', 1)
    status = re.search(rb'^Status:\s*(\d+)', head)
    match = TIMING.search(head)
    if status is None or match is None:
        raise RuntimeError('CGI status or Server-Timing header missing')
    status_code = int(status[1])
    data = json.loads(payload)
    return (float(match[1]), float(match[2]), wall_ms, status_code), data


def run_scenario(binary, state_dir, clients, polls):
    # Each virtual device gets a different IP; production retains MAX_PER_IP.
    sessions = []
    for idx in range(clients):
        ip = f'127.0.0.{idx + 2}'
        sample, response = request(binary, state_dir, ip, 'register',
                                   {'name': f'Bench device {idx}', 'deviceType': 'desktop'})
        if sample[3] != 200:
            raise RuntimeError(f'benchmark registration failed ({sample[3]})')
        sessions.append((ip, response))

    def poll(index):
        ip, session = sessions[index % clients]
        action = 'peers' if index % 4 == 0 else 'poll'
        extra = {'acks': [], 'visible': True, 'busy': False} if action == 'poll' else {}
        sample, _ = request(binary, state_dir, ip, action,
                            {'id': session['id'], 'token': session['token'], **extra})
        return sample

    with ThreadPoolExecutor(max_workers=clients) as pool:
        samples = list(pool.map(poll, range(clients * polls)))
    return summarize(samples)


def run_benchmark(groups, polls, max_p95_ms=None):
    if not groups or min(groups) < 1 or max(groups) > 24 or polls < 1 or polls > 100:
        raise ValueError('clients must be 1..24; polls per client must be 1..100')
    with tempfile.TemporaryDirectory(prefix='arcdrop-bench-') as temp:
        directory = Path(temp)
        binary = compile_cgi(directory)
        results = {}
        for clients in groups:
            state_dir = directory / f'peers-{clients}'
            results[str(clients)] = run_scenario(binary, state_dir, clients, polls)
    if max_p95_ms is not None and any(row['cgi_ms_p95'] > max_p95_ms for row in results.values()):
        raise RuntimeError('CGI p95 exceeded explicit benchmark threshold')
    return {'environment': 'HOST_TEST_ONLY_NOT_ROUTER', 'polls_per_client': polls, 'scenarios': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clients', default='2,6,12', help='comma-separated device counts (1..24)')
    parser.add_argument('--polls', type=int, default=8, help='requests per client (1..100)')
    parser.add_argument('--max-p95-ms', type=float, help='optional host-only CGI p95 ceiling')
    parser.add_argument('--json-out', type=Path, help='optional aggregate-only JSON output')
    args = parser.parse_args()
    try:
        groups = [int(x) for x in args.clients.split(',')]
        if len(groups) != len(set(groups)) or any(n < 1 or n > 24 for n in groups):
            raise ValueError('client counts must be unique and within 1..24')
        data = run_benchmark(groups, args.polls, args.max_p95_ms)
    except (ValueError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        parser.exit(1, f'FAIL: CGI benchmark: {exc}\n')
    rendered = json.dumps(data, ensure_ascii=False, indent=2)
    if args.json_out:
        args.json_out.write_text(rendered + '\n', encoding='utf-8')
    print(rendered)


if __name__ == '__main__':
    main()
