// Records herdsman /api/v1 responses into web/fixtures/ for the contract test (`node scripts/record-fixtures.mjs
// http://127.0.0.1:7777`). The repo is public: fleet names become fleet-1…, free text and repos are replaced, and
// each list (and the backlog's issues) keeps its first 3 rows, so only the shapes are recorded. An event's `data` and a
// config sheet's paths are dropped, `host`'s push key, devices and subscriptions emptied.
import fs from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:7777";
const TEXT = new Set(["title", "question", "detail", "fix", "shown", "message", "mtime", "line", "meta", "words", "code",
  "notes", "note", "paused", "decided", "paths", "labels", "why", "fail", "text", "plain", "raw", "run", "path",
  "local", "key", "label", "hash", "msg", "deny", "env", "notify", "global", "required"]);
const DROP = { data: {}, subs: [], devices: [], accounts: [] };

const seq = (await (await fetch(`${base}/api/v1/state`)).json()).seq;

for (const [path, q] of [["state", ""], ["queue", ""], ["host", ""], ["events", `?since=${seq - 500}&until=${seq}`]]) {
  const raw = await (await fetch(`${base}/api/v1/${path}${q}`)).json();
  if (path === "events") raw.fleets = (await (await fetch(`${base}/api/v1/state`)).json()).fleets;
  const fleets = new Map((raw.fleets ?? []).map((f, i) => [f.name, `fleet-${i + 1}`]));
  const longest = [...fleets].sort(([a], [b]) => b.length - a.length);
  if (path === "events") delete raw.fleets; // only for the names
  const scrub = (s) => longest.reduce((t, [real, fake]) => t.replaceAll(real, fake), s);
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.slice(0, 3).map((x) => walk(x, key));
    if (key in DROP) return DROP[key];
    if (key === "issues") return Object.fromEntries(Object.entries(v).slice(0, 3).map(([n, x]) => [n, walk(x)]));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    if (typeof v !== "string") return v;
    if (key === "repo") return "example/repo";
    if (TEXT.has(key) || key === "options") return `${key} text`;
    return scrub(v);
  };
  const out = new URL(`../web/fixtures/${path}.json`, import.meta.url);
  fs.writeFileSync(out, JSON.stringify(walk(raw), null, 2) + "\n");
  console.log(`recorded ${path}`);
}
