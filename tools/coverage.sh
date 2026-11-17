#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Optional host-only native CGI coverage; no generated files in the repository.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
for command in gcc gcov python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "FAIL: coverage requires $command (GCC/gcov on the host)" >&2
    exit 1
  fi
done
TMP=$(mktemp -d "${TMPDIR:-/tmp}/arcdrop-gcov.XXXXXXXX")
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
export ARCDROP_TEST_BIN="$TMP/arcdrop"
export ARCDROP_TEST_CC=gcc
export ARCDROP_TEST_CFLAGS='--coverage -O0'
python3 "$ROOT/tests/test_cgi.py"
if ! ls "$TMP"/*.gcda >/dev/null 2>&1; then
  echo 'FAIL: gcov counters were not generated' >&2
  exit 1
fi
(
  cd "$TMP"
  gcov -b -- ./*.gcda
)
echo 'PASS: ArcDrop native CGI coverage report generated in an ephemeral directory'
