#!/bin/sh
# BusyBox 25.12-oriented shell contract: only portable sh constructs in scripts.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for script in "$ROOT"/tests/*.sh; do
  sh -n "$script"
done
# No router-side shell daemon, package installation executes only native CGI.
if grep -E -n '(^|[[:space:]])(flock|systemctl|python3?|node|curl|wget|sort|awk)([[:space:]]|$)' "$ROOT/root/etc/arcdrop.conf"; then
  echo 'FAIL: unsupported runtime command in router configuration' >&2
  exit 1
fi
echo 'PASS: ArcDrop OpenWrt 25.12 BusyBox shell contract'
