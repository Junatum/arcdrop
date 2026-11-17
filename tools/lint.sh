#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Development/CI only: never installed in the OpenWrt firmware.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT"

for tool in npm ruff shellcheck clang clang-tidy pkg-config yamllint; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "FAIL: lint requires $tool (see docs/DEVELOPMENT.md)" >&2
    exit 1
  fi
done
if [ ! -x node_modules/.bin/eslint ] || [ ! -x node_modules/.bin/stylelint ] || [ ! -x node_modules/.bin/html-validate ]; then
  echo 'FAIL: install host-only JS lint dependencies with npm install' >&2
  exit 1
fi

printf '%s\n' '[lint] JavaScript / CSS / HTML'
npm run lint:web
printf '%s\n' '[lint] Python'
ruff check tests e2e tools
printf '%s\n' '[lint] Shell'
shellcheck --shell=sh tests/*.sh tools/*.sh
printf '%s\n' '[lint] C (warnings and clang static analyzer)'
# A native include flag may be needed on Homebrew macOS.
CFLAGS=$(pkg-config --cflags json-c)
# Intentional splitting of pkg-config flags (paths with spaces are unsupported by this
# host-only lint runner; normal OpenWrt Makefile uses toolchain flags instead).
# shellcheck disable=SC2086
clang -std=c11 -Wall -Wextra -Werror -fsyntax-only $CFLAGS src/*.c
for source in src/*.c; do
  # shellcheck disable=SC2086
  clang-tidy --quiet "$source" -- -std=c11 $CFLAGS
done
printf '%s\n' '[lint] SVG XML'
python3 tools/check_svg.py
printf '%s\n' '[lint] GitHub Actions YAML'
yamllint -c .yamllint.yml .github/workflows
printf '%s\n' 'PASS: ArcDrop all language linters'
