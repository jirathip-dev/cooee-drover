#!/bin/sh
# The verify instance (.herdsman/verify.md): the fixture herdsman on $PORT + 2 (scripts/fixture-herdsman.mjs, the
# recorded web/fixtures/, no live board), this checkout's drover backend on $PORT + 1, and cooee (its staging, built in
# $COOEE_DIR) on $PORT with the four tabs as plugins and a stub shed (no agents). The pairing code goes to $PAIR_CODE.
set -eu
cd "$(dirname "$0")/.."
: "${PORT:?}" "${COOEE_DIR:?}" "${PAIR_CODE:?}"
herdsman=$((PORT + 2)) drover=$((PORT + 1))
tmp=$(mktemp -d)
target() { (cd "$1" && cargo metadata --format-version 1 --no-deps |
  node -pe 'JSON.parse(require("fs").readFileSync(0)).target_directory'); }
RUSTUP_TOOLCHAIN=1.99.1 cargo build --quiet --locked   # CI's pin (rust-version 1.99); cooee keeps its own
(cd "$COOEE_DIR" && CARGO_NET_GIT_FETCH_WITH_CLI=true cargo build --quiet --locked -p cooee)
PORT=$herdsman node scripts/fixture-herdsman.mjs &
fake=$!
env HERDSMAN="http://127.0.0.1:$herdsman" DROVER_ADDR="127.0.0.1:$drover" \
  DROVER_QUEUE_TOKEN=queue-token-0123456789 DROVER_LANES_TOKEN=lanes-token-0123456789 \
  DROVER_ASKS_TOKEN=asks-token-0123456789 DROVER_FLEETS_TOKEN=fleets-token-0123456789 "$(target .)/debug/cooee-drover" &
backend=$!
trap 'kill "$fake" "$backend" 2>/dev/null' EXIT INT TERM

printf '#!/bin/sh\necho "[]"\n' >"$tmp/shed" && chmod +x "$tmp/shed"
cat >"$tmp/config.toml" <<EOF
port = $PORT
shed = "$tmp/shed"
shed_dir = "$tmp"
data = "$tmp/data"
EOF
for p in queue:Queue lanes:Lanes asks:Asks fleets:Fleets; do
  cat >>"$tmp/config.toml" <<EOF

[[plugins]]
name = "drover-${p%%:*}"
label = "${p#*:}"
url = "http://127.0.0.1:$drover"
module = "/${p%%:*}.js"
token = "${p%%:*}-token-0123456789"
EOF
done
cooee="$(target "$COOEE_DIR")/debug/cooee"
"$cooee" pair --config "$tmp/config.toml" | sed -n 's/^code: \([0-9]*\).*/\1/p' >"$PAIR_CODE"
"$cooee" serve --config "$tmp/config.toml" &
wait $!
