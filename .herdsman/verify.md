# Verify recipe: cooee-drover

drover's four tabs (Queue, Lanes, Asks, Fleets) are cooee plugins served by this repo's backend. The verify instance
is `scripts/verify-serve.sh`: a fixture herdsman (`scripts/fixture-herdsman.mjs`, serving the recorded
`web/fixtures/` as `/api/v1`, every op answering `READ_ONLY`), the checked-out head's drover backend, and cooee (its
`staging`, cloned into the lane folder) with the four tabs as plugins and a stub shed. No live board, no containers,
no agents, no logins.

Run every block from the worktree root, in one shell, so `OUT` and `P` stay set:

```sh
OUT="$PWD/.verify"            # the lane's own folder (git-ignored)
P="${HERDSMAN_PORT:?}"        # cooee on P, drover on P+1, the fixture herdsman on P+2
mkdir -p "$OUT"
```

## Launch

One-time per worktree: cooee's `staging` (a private repo: git's own auth) and its Playwright packages (the browsers
are already on the host for cooee's `ui` gate).

```sh
git clone -q --depth 1 -b staging git@github.com:jirathip-dev/cooee.git "$OUT/cooee"; echo "clone exit=$?"
(cd "$OUT/cooee/web/e2e" && npm ci) >"$OUT/npm-ci.log" 2>&1; echo "npm ci exit=$?"
```

Start it in its own process group, so teardown stops every child (fixture herdsman, drover, cooee). The script builds
drover with rustc 1.99.1 (CI's pin) and cooee with its own `rust-toolchain.toml`:

```sh
PORT="$P" COOEE_DIR="$OUT/cooee" PAIR_CODE="$OUT/code" nohup perl -e 'setpgrp(0, 0); exec @ARGV' scripts/verify-serve.sh >"$OUT/server.log" 2>&1 &
echo $! >"$OUT/server.pid"
```

Ready signal: cooee's `/pair` answers and the pairing code is written. A cold build takes minutes, a warm one seconds:

```sh
for i in $(seq 900); do curl -fs -o /dev/null "http://127.0.0.1:$P/pair" && test -s "$OUT/code" && break
  kill -0 "$(cat "$OUT/server.pid")" 2>/dev/null || { echo "server exited"; break; }; sleep 1; done
echo "ready after ${i}s"; cat "$OUT/server.log"
```

`server.log` holds the build errors if it never gets ready, then one line each: `fixture herdsman on …`,
`cooee-drover on …`, `cooee: listening on …` (cooee's `shed.sock: No such file` line is the stub shed, harmless).

Teardown (the pid is the group id):

```sh
kill -TERM -- "-$(cat "$OUT/server.pid")"; echo "kill exit=$?"
for p in "$P" $((P + 1)) $((P + 2)); do curl -s -o /dev/null "http://127.0.0.1:$p/"; echo "curl $p exit=$? (7: nothing listens)"; done
```

## Doctor

Read-only: cooee sends an unpaired `/` to `/pair`, the code is six digits, drover forwards a tab's token to the
fixture herdsman (three fleets in `queue`) and serves that tab's module.

```sh
T="Authorization: Bearer queue-token-0123456789"
test "$(curl -s -o /dev/null -w '%{redirect_url}' "http://127.0.0.1:$P/")" = "http://127.0.0.1:$P/pair" &&
  grep -Eq '^[0-9]{6}$' "$OUT/code" &&
  test "$(curl -s -H "$T" "http://127.0.0.1:$((P + 1))/api/v1/queue" | node -pe 'JSON.parse(require("fs").readFileSync(0)).fleets.length')" = 3 &&
  test "$(curl -s -o /dev/null -w '%{http_code}' -H "$T" "http://127.0.0.1:$((P + 1))/queue.js")" = 200
echo "doctor exit=$?"
```

## Drive

Every cooee page but `/pair` needs a paired browser: fill the code from `$OUT/code` into the `pairing code` field,
press `pair`, keep the cookie. A code pairs once (a second run needs a fresh Launch): the script saves the cookie to
`$OUT/state.json` for reuse.

The script below pairs, then opens each tab at 390 and 1440 px and screenshots it once its ready element shows, plus
one tap per tab: a queue row's card, an op's answer, a fleet's config sheet. It runs from cooee's `web/e2e` so
`@playwright/test` resolves. Add the PR's own steps after the tab it touches.

```sh
cat >"$OUT/drive.mjs" <<'EOF'
import { chromium } from "@playwright/test";
import fs from "node:fs";
const out = process.env.OUT, base = `http://127.0.0.1:${process.env.P}`;
const browser = await chromium.launch();
const pair = await browser.newPage({ baseURL: base });
await pair.goto("/");
console.log("unpaired / ->", new URL(pair.url()).pathname);
await pair.getByLabel("pairing code").fill(fs.readFileSync(`${out}/code`, "utf8").trim());
await pair.getByRole("button", { name: "pair" }).click();
await pair.waitForURL(/\/$/, { waitUntil: "commit" });
await pair.context().storageState({ path: `${out}/state.json` });
console.log("paired ->", new URL(pair.url()).pathname);
for (const w of [390, 1440]) {
  const page = await browser.newPage({ baseURL: base, viewport: { width: w, height: w === 390 ? 844 : 900 }, storageState: `${out}/state.json` });
  const tab = page.frameLocator("iframe.pf");
  const shot = async (name, ready) => {
    await ready.waitFor();
    await page.screenshot({ path: `${out}/${w}-${name}.png`, fullPage: true });
    console.log(`${w} ${name} ok`);
  };
  await page.goto("/p/drover-queue");
  await shot("queue", tab.locator(".fc .qg .q").first());
  await tab.locator(".rl", { hasText: "#22" }).click();
  await shot("queue-issue", tab.locator(".cd").getByText("LINKS"));
  await tab.getByRole("button", { name: "Drive now" }).click();
  await shot("queue-op", tab.getByText("READ_ONLY"));
  await page.goto("/p/drover-lanes");
  await shot("lanes", tab.locator("h2 + ul a").first());
  await page.goto("/p/drover-asks");
  await shot("asks", tab.locator(".ask").first());
  await page.goto("/p/drover-fleets");
  await shot("fleets", tab.getByText("HOSTS FOR LANES"));
  await tab.locator(".fc .lk", { hasText: "fleet-1" }).click();
  await shot("fleets-config", tab.locator(".fc .cg").first());
  await page.close();
}
await browser.close();
EOF
(cd "$OUT/cooee/web/e2e" && OUT="$OUT" P="$P" node --input-type=module - <"$OUT/drive.mjs") >"$OUT/drive.log" 2>&1
echo "drive exit=$?"; cat "$OUT/drive.log"
```

Selectors this UI answers to (from `web/src/lib/*.ts`; the fixtures' fleets are `fleet-1` … `fleet-3`):

- cooee: a tab at `/p/drover-<tab>`, its frame `iframe.pf` (drive inside it with a frame locator), header tab links
  `Queue`, `Lanes`, `Asks`, `Fleets`
- Queue: repo chips `.chips .chip` (`fleet-1 3` … `all 0`, legend `?`), the fleet card `.fc`, buttons `Drive now`,
  `Pause`, group `.qg` with `h3` (`in progress (2)`, `queued (1)`), rows `.q .rl` (`#32`, `#22`, `#30`); a row's tap
  opens its card `.cd` (`STATUS`, `LINKS`, verdicts, `LANES (n)`); ←/→ or a sideways swipe switches repo
- Lanes: `h2` per role (`other`, `design`, `impl`), each lane a link `ul a` to `/p/drover-lanes#lane/<name>`
- Asks: the bar `.bar` (`needs you` and its badge), cards `.ask` with numbered option buttons, the answer field
  `placeholder="or type an answer"`, buttons `Send`, `later`
- Fleets: `h2` sections `FLEETS`, `CHAT DEFAULTS`, `HOSTS FOR LANES`, `FLEET DISK`, `NOTIFIERS`, `ACTIVITY`; a fleet
  card `.fc .lk` opens its config sheet `.cg` (`General`, `Pipeline`, …)
- Ops (any button that writes): the fixture herdsman answers `READ_ONLY: the fixture herdsman takes no ops`, shown in
  the tab; a PR that changes an op's request is checked in `server.log` (`POST /api/v1/<op> 405`)

## Evidence

- Screenshots: `$OUT/390-<screen>.png` and `$OUT/1440-<screen>.png` (full page, viewports 390×844 and 1440×900),
  one pair per screen the drive opened; list both widths in `verdict.md`.
- Transcript: `$OUT/server.log` (builds, the fixture herdsman's request lines, drover, cooee), `$OUT/drive.log` (one
  `<width> <screen> ok` line per shot).
- Exit codes to record: `clone`, `npm ci`, the ready loop (`ready after Ns`), `doctor`, `drive`, the teardown `kill`
  and the three closing `curl`s (7).

## Feature map

| Screen / feature | How to reach it |
|---|---|
| Queue tab (per-repo queue, groups, done today, backlog) | `/p/drover-queue`, or header `Queue` |
| Queue issue card (status, links, verdicts, lanes) | Queue tab → a row `.rl` (`#22` has the fixture's verdict) |
| Queue ops (Drive now, Pause, ▲/▼, marks) | Queue tab → the button; answers `READ_ONLY` |
| Lanes tab (lanes by role) | `/p/drover-lanes`, or header `Lanes` |
| Asks tab (needs-you cards, answers, later) | `/p/drover-asks`, or header `Asks` |
| Fleets tab (fleets, chat defaults, hosts, disk, notifiers, activity) | `/p/drover-fleets`, or header `Fleets` |
| Fleet config sheet (general, pipeline, roles) | Fleets tab → a fleet card `.fc .lk` |
| The backend's own routes | `http://127.0.0.1:$((P + 1))/<tab>.js` and `/api/v1/*` with `Authorization: Bearer <tab>-token-0123456789` |
