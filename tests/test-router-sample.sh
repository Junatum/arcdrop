#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH='' cd -- "$(dirname "$0")/.." && pwd)
SAMPLER=$ROOT/tools/router-sample.sh
sh -n "$SAMPLER"

# Emulate only the read-only commands used by the router. This test must work
# on macOS CI (which lacks free and /proc) as well as on Linux.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT HUP INT TERM
mkdir -p "$TMP/bin" "$TMP/no-free"
cat > "$TMP/bin/uname" <<'EOF_UNAME'
#!/bin/sh
printf 'Linux\n'
EOF_UNAME
cat > "$TMP/bin/date" <<'EOF_DATE'
#!/bin/sh
printf 'time=2026-11-18T00:00:00+0000\n'
EOF_DATE
cat > "$TMP/bin/uptime" <<'EOF_UPTIME'
#!/bin/sh
printf 'up 1 day, load average: 0.01, 0.02, 0.03\n'
EOF_UPTIME
cat > "$TMP/bin/free" <<'EOF_FREE'
#!/bin/sh
printf 'Mem: 131072 65536 65536\n'
EOF_FREE
cat > "$TMP/bin/df" <<'EOF_DF'
#!/bin/sh
[ "$1" = '-k' ] && [ "$2" = '/tmp' ] || exit 1
printf 'Filesystem 1K-blocks Used Available Use%% Mounted on\n'
printf 'tmpfs 131072 1024 130048 1%% /tmp\n'
EOF_DF
chmod +x "$TMP"/bin/*

# A mock Linux router proves the sampler works without using host-specific
# utilities, secrets, a network service, or actual hardware.
OUTPUT=$(PATH="$TMP/bin:$PATH" sh "$SAMPLER" 1 1)
printf '%s\n' "$OUTPUT" | grep -q -- '--- sample 1 / 1 ---'
printf '%s\n' "$OUTPUT" | grep -q 'time='
printf '%s\n' "$OUTPUT" | grep -q 'Mem:'
printf '%s\n' "$OUTPUT" | grep -q 'Filesystem'

# Verify that accidental execution on macOS is rejected before sampling.
cat > "$TMP/bin/uname" <<'EOF_DARWIN'
#!/bin/sh
printf 'Darwin\n'
EOF_DARWIN
if PATH="$TMP/bin:$PATH" sh "$SAMPLER" 1 1 >"$TMP/out" 2>"$TMP/err"; then
  echo 'FAIL: non-Linux sampler execution must be refused' >&2
  exit 1
fi
if ! grep -q 'OpenWrt/Linux router' "$TMP/err"; then
  echo 'FAIL: unsupported platform needs a clear diagnostic' >&2
  exit 1
fi

# Restore the mock router for the invalid argument checks.
cat > "$TMP/bin/uname" <<'EOF_UNAME'
#!/bin/sh
printf 'Linux\n'
EOF_UNAME
if PATH="$TMP/bin:$PATH" sh "$SAMPLER" 0 1 >/dev/null 2>&1; then
  echo 'FAIL: sample interval zero should be refused' >&2
  exit 1
fi
if PATH="$TMP/bin:$PATH" sh "$SAMPLER" 1 301 >/dev/null 2>&1; then
  echo 'FAIL: unbounded sample count should be refused' >&2
  exit 1
fi

# Check Linux /proc fallback with free absent. Other platforms have no procfs.
if [ -r /proc/meminfo ]; then
  for command_name in uname date uptime df; do
    cp "$TMP/bin/$command_name" "$TMP/no-free/$command_name"
  done
  ln -s "$(command -v awk)" "$TMP/no-free/awk"
  OUTPUT=$(PATH="$TMP/no-free" /bin/sh "$SAMPLER" 1 1)
  printf '%s\n' "$OUTPUT" | grep -q 'Mem: total=[0-9][0-9]*KiB available=[0-9][0-9]*KiB'
fi

if grep -E 'cat +/tmp/arcdrop|ARCDROP_TEST_MODE|curl|wget|/cgi-bin/' "$SAMPLER"; then
  echo 'FAIL: router sampler must not access CGI metadata or network endpoints' >&2
  exit 1
fi
echo 'PASS: ArcDrop read-only BusyBox router resource sampling'
