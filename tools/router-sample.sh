#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Read-only BusyBox-compatible sampler. Copy manually to a trusted router.
# Does not inspect ArcDrop session files, request bodies or auth tokens.
set -eu
INTERVAL=${1:-10}
SAMPLES=${2:-30}
case "$INTERVAL:$SAMPLES" in
  *[!0-9:]*|:*|*:) echo 'Usage: sh router-sample.sh [interval 1..3600] [samples 1..300]' >&2; exit 2 ;;
esac
if [ "$INTERVAL" -lt 1 ] || [ "$INTERVAL" -gt 3600 ] ||
   [ "$SAMPLES" -lt 1 ] || [ "$SAMPLES" -gt 300 ] ||
   [ $((INTERVAL * SAMPLES)) -gt 3600 ]; then
  echo 'FAIL: sampling arguments out of range' >&2
  exit 2
fi

# This tool measures the router, not the Mac used to develop it.
if [ "$(uname -s)" != 'Linux' ]; then
  echo 'FAIL: router-sample.sh must run on an OpenWrt/Linux router. Copy it to the router and execute it over SSH.' >&2
  exit 2
fi

sample_memory() {
  if command -v free >/dev/null 2>&1; then
    free
  elif [ -r /proc/meminfo ]; then
    # BusyBox systems may omit the free applet; /proc/meminfo is the source of truth.
    awk '
      $1 == "MemTotal:"     { total = $2 }
      $1 == "MemAvailable:" { available = $2 }
      $1 == "MemFree:"      { memory_free = $2 }
      $1 == "Buffers:"      { buffers = $2 }
      $1 == "Cached:"       { cached = $2 }
      END {
        if (total == 0) exit 1
        if (available == 0) available = memory_free + buffers + cached
        printf "Mem: total=%dKiB available=%dKiB\n", total, available
      }
    ' /proc/meminfo
  else
    echo 'FAIL: memory information is unavailable (free and /proc/meminfo missing)' >&2
    return 1
  fi
}

count=1
while [ "$count" -le "$SAMPLES" ]; do
  printf '%s\n' "--- sample $count / $SAMPLES ---"
  date '+time=%Y-%m-%dT%H:%M:%S%z'
  uptime
  sample_memory
  df -k /tmp
  if [ "$count" -lt "$SAMPLES" ]; then sleep "$INTERVAL"; fi
  count=$((count + 1))
done
