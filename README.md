# cooee-drover
drover plugins for cooee: queue, lanes, asks and system tabs over herdsman /api/v1

## Run

One backend serves the four tabs. Each gets its own token (at least 16 characters):

```sh
HERDSMAN=http://127.0.0.1:7777 DROVER_ADDR=127.0.0.1:4810 \
DROVER_QUEUE_TOKEN=… DROVER_LANES_TOKEN=… DROVER_ASKS_TOKEN=… DROVER_SYSTEM_TOKEN=… cargo run --release
```

herdsman takes its paired ops (Drive now, an answer, queueing from the backlog) from a paired device only: set
`HERDSMAN_COOKIE` to a paired device's cookie (`hd=…`, from a browser paired with `Pair this phone` on herdsman's board) and the
backend sends it with every call. Without it those taps answer `UNPAIRED`.

The Asks tab's alert for an answer herdsman couldn't deliver to its lane is also a push to your phone: set `COOEE` to
cooee's URL (e.g. `COOEE=http://127.0.0.1:4747`) and the backend reads herdsman's events every 30 s
(`DROVER_POLL_SECS`), pushing each new `answer-undelivered` through cooee with the asks plugin's token.

In cooee's `config.toml`, one entry per tab, all on the same `url`, each with its own module and token:

```toml
[[plugins]]
name = "drover-queue"
label = "Queue"
url = "http://127.0.0.1:4810"
module = "/queue.js"
token = "…"               # = DROVER_QUEUE_TOKEN
# drover-lanes (/lanes.js), drover-asks (/asks.js), drover-system (/system.js) alike
```

The tabs live in `web/` (TypeScript; `npm ci && npm run build` writes the committed `web/dist/`, which the binary
embeds). `node scripts/record-fixtures.mjs <herdsman url>` re-records the contract test's redacted fixtures.
