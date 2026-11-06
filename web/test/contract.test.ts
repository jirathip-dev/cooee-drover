// The contract test: herdsman's recorded /api/v1 responses (fixtures/, `scripts/record-fixtures.mjs`) still fit the
// shapes the tabs parse, and each tab's view of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { askHref, route } from "../src/lib/links.ts";
import { parseEvents, parseNeeds, parseQueue, parseState } from "../src/lib/types.ts";
import { lanesView, systemView } from "../src/lib/views.ts";

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

test("lanes and asks link across tabs, and the link's hash routes back", () => {
  const lane = lanesView(state)[0].items[0];
  assert.equal(lane.href, `/p/drover-lanes#lane/${raw.lanes[0].name}`);
  assert.deepEqual(route(lane.href!.slice(lane.href!.indexOf("#"))), { kind: "lane", id: raw.lanes[0].name });
  assert.equal(askHref(raw.asks[0].id), `/p/drover-asks#ask/${raw.asks[0].id}`);
  assert.equal(route("#queue"), null);
});

test("the system tab shows hosts, services and alerts", () => {
  const v = systemView(state);
  assert.deepEqual(v.map((s) => s.title), ["Hosts", "Services", "Alerts"]);
  assert.equal(v[0].items[0].text, `${raw.hosts[0].name} · ${raw.hosts[0].detail}`);
});
