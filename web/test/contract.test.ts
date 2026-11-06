// The contract test: herdsman's recorded /api/v1 responses (fixtures/, `scripts/record-fixtures.mjs`) still fit the
// shapes the tabs parse, and each tab's view of them.
import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { route } from "../src/lib/links.ts";
import { parseState } from "../src/lib/types.ts";
import { asksView, lanesView, queueView, systemView } from "../src/lib/views.ts";

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
  assert.throws(() => parseState({ ...raw, asks }), /at asks\[0\]\.options$/);
});

test("the queue tab lists the fleet names", () => {
  const items = queueView(state)[0].items;
  assert.deepEqual(
    items.map((i) => i.text.split(" · ")[0]),
    raw.fleets.map((f: { name: string }) => f.name),
  );
});

test("lanes and asks link across tabs, and the link's hash routes back", () => {
  const lane = lanesView(state)[0].items[0];
  assert.equal(lane.href, `/p/drover-lanes#lane/${raw.lanes[0].name}`);
  assert.deepEqual(route(lane.href!.slice(lane.href!.indexOf("#"))), { kind: "lane", id: raw.lanes[0].name });
  const ask = asksView(state)[0].items[0];
  assert.equal(ask.href, `/p/drover-asks#ask/${raw.asks[0].id}`);
  assert.equal(route("#queue"), null);
});

test("the system tab shows hosts, services and alerts", () => {
  const v = systemView(state);
  assert.deepEqual(v.map((s) => s.title), ["Hosts", "Services", "Alerts"]);
  assert.equal(v[0].items[0].text, `${raw.hosts[0].name} · ${raw.hosts[0].detail}`);
});
