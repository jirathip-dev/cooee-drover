#!/usr/bin/env bash
# Each tab module's budget: cooee inlines it into the frame page on every tab open.
set -euo pipefail
cd "$(dirname "$0")/.."
budget=16384
fail=0
for f in web/dist/queue.js web/dist/lanes.js web/dist/asks.js web/dist/system.js; do
  n=$(wc -c <"$f" | tr -d ' ')
  echo "$f: $n of $budget bytes"
  test "$n" -le "$budget" || fail=1
done
exit "$fail"
