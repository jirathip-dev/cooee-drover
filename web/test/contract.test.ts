// The contract test: herdsman's recorded /api/v1 responses (fixtures/, `scripts/record-fixtures.mjs`) still fit the
// shapes the tabs parse, and each tab's view of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { askHref, route } from "../src/lib/links.ts";
import { parseEvents, parseIssue, parseNeeds, parseQueue, parseState } from "../src/lib/types.ts";
import { lanesView } from "../src/lib/views.ts";

const raw = JSON.parse(fs.readFileSync(new URL("../fixtures/state.json", import.meta.url), "utf8"));
const state = parseState(raw);

test("the recorded state fits the contract", () => {
  assert.ok(state.fleets.length > 0 && state.lanes.length > 0 && state.asks.length > 0 && state.hosts.length > 0);
});

test("a dropped or retyped field breaks the contract, naming it", () => {
  assert.throws(() => parseState({ ...raw, fleets: undefined }), /at fleets$/);
  const lanes = [{ ...raw.lanes[0], since: "0" }];
  assert.throws(() => parseState({ ...raw, lanes }), /at lanes\[0\]\.since$/);
  const asks = [{ ...raw.asks[0], options: [1] }];
  assert.throws(() => parseState({ ...raw, asks }), /at asks\[0\]\.options\[0\]$/);
});

test("the recorded queue fits the contract; a retyped field breaks it, naming it", () => {
  const q = JSON.parse(fs.readFileSync(new URL("../fixtures/queue.json", import.meta.url), "utf8"));
  assert.ok(parseQueue(q).fleets[0].rows.length > 0);
  q.fleets[1].rows[0].stage = [{ name: "impl" }];
  assert.throws(() => parseQueue(q), /queue broke the contract at fleets\[1\]\.rows\[0\]\.stage\[0\]\.k$/);
  q.fleets[1].backlog.issues["22"].labels = "x";
  q.fleets[1].rows[0].stage = [];
  assert.throws(() => parseQueue(q), /at fleets\[1\]\.backlog\.issues\.22\.labels$/);
  q.fleets[1].backlog.issues["22"].labels = [];
  q.fleets[2].marks["2"].verify = true;
  assert.throws(() => parseQueue(q), /at fleets\[2\]\.marks\.2\.verify$/);
});

test("herdsman#576: the recorded issue's verdicts and the queue's marks fit the contract; a retyped field breaks it", () => {
  const q = parseQueue(JSON.parse(fs.readFileSync(new URL("../fixtures/queue.json", import.meta.url), "utf8")));
  assert.deepEqual(q.fleets.map((c) => Object.keys(c.marks).map(Number).sort((a, b) => a - b)), q.fleets.map((c) => c.rows.map((r) => r.issue).sort((a, b) => a - b)));
  const i = JSON.parse(fs.readFileSync(new URL("../fixtures/issue.json", import.meta.url), "utf8"));
  assert.deepEqual(parseIssue(i).verdicts.map((v) => [v.role, v.verdict, v.shots.length]), [["verify", "PASS", 2], ["rev", "PASS", 0]]);
  i.verdicts[0].shots = [1];
  assert.throws(() => parseIssue(i), /issue broke the contract at verdicts\[0\]\.shots\[0\]$/);
  i.verdicts[0].shots = [];
  assert.deepEqual(parseIssue(i).verdicts.map((v) => v.repro?.kind ?? null), [null, "run"], "#15: the rev PASS's Repro: block");
  assert.equal(q.fleets[0].marks["22"].repro, true);
  i.verdicts[1].repro.text = ["x"];
  assert.throws(() => parseIssue(i), /issue broke the contract at verdicts\[1\]\.repro\.text$/);
});

test("the recorded needs and events fit the contract; a retyped field breaks it, naming it", () => {
  const n = JSON.parse(fs.readFileSync(new URL("../fixtures/needs.json", import.meta.url), "utf8"));
  assert.ok(parseNeeds(n).asks.length > 0);
  n.asks[0].pngs = [0];
  assert.throws(() => parseNeeds(n), /needs broke the contract at asks\[0\]\.pngs\[0\]$/);
  n.asks[0].pngs = [];
  n.blocked = [{ name: "l", who: "w", push: false, menu: { title: "t" } }];
  assert.throws(() => parseNeeds(n), /at blocked\[0\]\.menu\.reason$/);
  const e = JSON.parse(fs.readFileSync(new URL("../fixtures/events.json", import.meta.url), "utf8"));
  assert.ok(parseEvents(e).list.length > 0);
  e.list[0].data = null;
  assert.throws(() => parseEvents(e), /events broke the contract at list\[0\]\.data$/);
});

test("a verify lane shows under its own role, like rev", () => {
  const lane = (name: string, role: string) => ({ ...raw.lanes[0], name, role });
  const s = parseState({ ...raw, lanes: [lane("f-impl-1", "impl"), lane("f-rev-1", "rev"), lane("f-verify-1", "verify"), lane("f-impl-2", "impl")] });
  assert.deepEqual(lanesView(s).map((x) => [x.title, x.items.map((l) => l.text.split(" ")[0])]), [
    ["impl", ["f-impl-1", "f-impl-2"]], ["rev", ["f-rev-1"]], ["verify", ["f-verify-1"]],
  ]);
});

test("lanes and asks link across tabs, and the link's hash routes back", () => {
  const lane = lanesView(state)[0].items[0];
  assert.equal(lane.href, `/p/drover-lanes#lane/${raw.lanes[0].name}`);
  assert.deepEqual(route(lane.href!.slice(lane.href!.indexOf("#"))), { kind: "lane", id: raw.lanes[0].name });
  assert.equal(askHref(raw.asks[0].id), `/p/drover-asks#ask/${raw.asks[0].id}`);
  assert.equal(route("#queue"), null);
});
