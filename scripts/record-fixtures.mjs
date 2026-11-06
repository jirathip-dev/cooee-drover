// Records herdsman /api/v1 responses into web/fixtures/ for the contract test (`node scripts/record-fixtures.mjs
// http://127.0.0.1:7777`). The repo is public: fleet names become fleet-1…, free text and repos are replaced, and
// each list (and the backlog's issues) keeps its first 3 rows, so only the shapes are recorded. A config sheet's paths
// are replaced; `host`'s push key, devices, subscriptions and accounts emptied.
import fs from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:7777";
const TEXT = new Set(["title", "question", "detail", "fix", "shown", "message", "mtime", "line", "meta", "words", "code",
  "notes", "note", "paused", "decided", "kind", "paths", "labels", "why", "fail", "reason", "plain", "result", "run",
  "activity", "tail", "command", "thread", "from", "path", "local", "key", "label", "hash", "msg", "deny", "env",
  "notify", "global", "required"]);
const DROP = { subs: [], devices: [], accounts: [] };
const read = async (path) => (await fetch(`${base}/api/v1/${path}`)).json();
// state's fleets name every fleet; needs and events (the newest 40) are scrubbed by the same map.
const state = await read("state");
const fleets = new Map(state.fleets.map((f, i) => [f.name, `fleet-${i + 1}`]));
const longest = [...fleets].sort(([a], [b]) => b.length - a.length);

for (const [path, file] of [["state", "state"], ["queue", "queue"], ["needs", "needs"], ["host", "host"], [`events?since=${state.seq - 40}`, "events"]]) {
  const raw = path === "state" ? state : await read(path);
  const scrub = (s) => longest.reduce((t, [real, fake]) => t.replaceAll(real, fake), s);
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.slice(0, 3).map((x) => walk(x, key));
    // An event's `data` is free-form: its strings become `<key> text`, its lists and objects null.
    if (key === "data") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? `${k} text` : typeof x === "object" ? null : x]));
    if (key in DROP) return DROP[key];
    if (key === "issues") return Object.fromEntries(Object.entries(v).slice(0, 3).map(([n, x]) => [n, walk(x)]));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    if (typeof v !== "string") return v;
    if (key === "repo") return "example/repo";
    if (key === "kind" && /^(build|check|gate)$/.test(v)) return v; // a pipeline stage's kind
    if (TEXT.has(key) || key === "options") return `${key} text`;
    return scrub(v);
  };
  const out = new URL(`../web/fixtures/${file}.json`, import.meta.url);
  fs.writeFileSync(out, JSON.stringify(walk(raw), null, 2) + "\n");
  console.log(`recorded ${file}`);
}
