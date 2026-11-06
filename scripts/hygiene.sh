#!/usr/bin/env bash
# Public-repo hygiene: no tailnet hostname, home path, chat ID, private key, token-looking value or private org's name
# in a tracked file (the recorded fixtures are redacted by scripts/record-fixtures.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."
pat='[A-Za-z0-9-]\.ts\.net|/Users/|/home/[a-z]|telegram:-?[0-9]|BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}|synergy'
bad=$(git ls-files -z | grep -zv '^scripts/hygiene.sh$' | xargs -0 grep -nIE "$pat" || true)
test -z "$bad" || { echo "not for a public repo:"; echo "$bad"; exit 1; }
echo "hygiene: clean"
