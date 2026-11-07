# cooee-drover
drover plugins for cooee: the Queue, Asks and Fleets tabs over herdsman /api/v1

## How it fits

```
cooee (the app)  ──tab calls──▶  cooee-drover (this repo)  ──passes through──▶  herdsman /api/v1 (the engine)
                 ◀──── one push (answer-undelivered) ──────
```

Three repos, three jobs:

- **[herdsman](https://github.com/jirathip-dev/herdsman)** is the engine: the queue, drive, lanes, reviews, gates and
  merge. It owns all state and every rule, and serves it at `/api/v1` (`state`, `queue`, `needs`, `host`, `events`,
  `issue/<fleet>/<n>`, plus a `POST /api/v1/<op>` per action). It is being renamed drover
  ([herdsman#456](https://github.com/jirathip-dev/herdsman/issues/456)).
- **[cooee](https://github.com/jirathip-dev/cooee)** is the app: chats, and shed sessions, which include herdsman's
  lanes as Workflow chats ([cooee#33](https://github.com/jirathip-dev/cooee/issues/33)). It loads plugin tabs and
  sends pushes to the phone.
- **cooee-drover** is three cooee tabs, Queue, Asks and Fleets (`web/src/`), that read and act through herdsman's
  `/api/v1`. Its backend (`src/main.rs`) only passes calls through, adding each tab's token and the paired-device
  cookie, and forwards one push (an answer herdsman couldn't deliver). No engine logic lives here: a tab shows what
  herdsman sends and posts what the user taps.

The lanes tab moved to cooee core in the 2026-11-06 re-mapping (lane rows are cooee's Workflow chats). Its leftover
module (`web/src/lanes.ts`) is still built but isn't one of the tabs; don't add it to cooee.

## Adding a feature

A Queue, Asks or Fleets feature that needs data herdsman doesn't send yet goes in this order:

1. **herdsman** adds the field to `/api/v1` (its issue and PR come first, and merge first).
2. **cooee-drover** re-records the fixtures from a herdsman that has it (`node scripts/record-fixtures.mjs <herdsman
   url>` writes `web/fixtures/`), adds the field to `web/src/lib/types.ts` and its contract check, and the tab
   displays it.

drover never derives engine state itself: no counting, guessing or parsing of what herdsman means. If a screen needs
something, herdsman sends it. [#21](https://github.com/jirathip-dev/cooee-drover/issues/21) is the example: for a
Queue row chip saying where an issue's lane runs, herdsman first adds a `where` label to each `/api/v1/queue` row's
active lane ([herdsman#609](https://github.com/jirathip-dev/herdsman/issues/609)), then drover re-records
`web/fixtures/queue.json` and shows the label verbatim, with no host or runtime names of its own. A feature that needs only cooee itself (chats, sessions) goes in cooee, not here.

## Parity

[herdsman#553](https://github.com/jirathip-dev/herdsman/issues/553) lists every feature of herdsman's old board and
chat, each mapped to cooee core or a drover tab with the API it needs and a phone check. Here that means: each tab
covers its rows of that list, and the old board retires once every row passes on the owner's phone.

## Run

One backend serves the three tabs. Each gets its own token (at least 16 characters):

```sh
HERDSMAN=http://127.0.0.1:7777 DROVER_ADDR=127.0.0.1:4810 \
DROVER_QUEUE_TOKEN=… DROVER_ASKS_TOKEN=… DROVER_FLEETS_TOKEN=… cargo run --release
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
# drover-asks (/asks.js) and drover-fleets (/fleets.js) alike
```

The tabs live in `web/` (TypeScript; `npm ci && npm run build` writes the committed `web/dist/`, which the binary
embeds). `node scripts/record-fixtures.mjs <herdsman url>` re-records the contract test's redacted fixtures.
