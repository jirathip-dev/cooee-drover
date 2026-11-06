#!/usr/bin/env bash
# Non-test lines (src/*.rs, web/src/*.ts) against ci/cap.toml's line_cap; exit 1 over it.
set -euo pipefail
cd "$(dirname "$0")/.."
cap=$(sed -nE 's/^line_cap *= *([0-9]+).*/\1/p' ci/cap.toml)
n=$(git ls-files 'src/*.rs' 'web/src/*.ts' | xargs cat | wc -l | tr -d ' ')
echo "non-test lines: $n of $cap"
test "$n" -le "$cap" || { echo "over the line cap ($cap): trim, or ask the owner to raise it"; exit 1; }
