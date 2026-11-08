PASS

Reviewed head: 03a5e66fe131d8ef671a67354751f59ee7145053
Tests checked against anti-patterns: yes

Verified at this head: `cargo test --locked` (13 passed); `npm test` in web/ (69 passed on three runs). CI `rust` and `web` are green. The PR body carries `## For humans`, no AI attribution, and evidence anchored at this exact sha. The commit has no AI trailer.

Findings (all non-blocking):
- non-blocking web/src/lib/asks.ts:50-70: scope 2 lists "merged, or lane gone" endings and the issue sheet, but the ended list shows only decision, withdrawn, delivered, failed and expired. The PR body discloses this: herdsman logs no id-bearing event for those two endings, and matching them would copy herdsman's rule into drover. Those asks never show as cards, because the tab shows only what `needs` lists. Ask for a follow-up once herdsman exposes the ending.
- non-blocking web/fixtures/endings.json: scope 4 wants an ask of each ending recorded. Typed and withdrawn are not in herdsman's log yet, so the tests build them from the recorded answer (web/test/asks.test.ts, the `typed` and `withdrawn` consts). Disclosed; re-record once herdsman logs them.
- non-blocking web/test/asks.test.ts, "an open ask from a live lane older than 24 h": it would also pass on the old code, since the tab never filtered by age. It is a guard, not a regression test. The other `#17` tab tests do go red on the old code, as they need `listen`, `ended` and the endings fixture.
- non-blocking web/test/reliability.test.ts (R6, 300 ms budget): failed once on my first run while cargo was building in parallel (7 s), then passed on three reruns. This is load-dependent timing and not caused by this diff.
- non-blocking .gitignore: `target*/` is unrelated to #17. It is harmless.
- non-blocking web/src/asks.ts, `t.listen()`: it relies on cooee's `cooee.events` to reconnect. The 15 s poll is the fallback.

Biggest remaining gap: merged and lane-gone endings are not shown in history (disclosed, justified).

Could not verify: `tsc` and `biome` locally, because web/node_modules is absent (CI covers them). That web/dist matches a rebuild. `/live` through real cooee and herdsman in a browser. The 390 px screenshot of the asks tab with one open and one expired ask (the verify stage re-takes it; I did not open the `ui-390` artifact).
