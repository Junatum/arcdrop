#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
node --check "$ROOT/web/app.js"
node --check "$ROOT/web/demo.js"
echo 'PASS: ArcDrop 브라우저 JavaScript 문법 검사'
