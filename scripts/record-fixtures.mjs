// Records herdsman /api/v1 responses into web/fixtures/ for the contract test (`node scripts/record-fixtures.mjs
// http://127.0.0.1:7777`). The repo is public: fleet names become fleet-1…, free text and repos are replaced, and
// each list keeps its first 3 rows, so only the shapes are recorded.
import fs from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:7777";
const TEXT = new Set(["title", "question", "detail", "fix", "shown", "message", "mtime"]);

for (const path of ["state"]) {
  const raw = await (await fetch(`${base}/api/v1/${path}`)).json();
  const fleets = new Map((raw.fleets ?? []).map((f, i) => [f.name, `fleet-${i + 1}`]));
  const longest = [...fleets].sort(([a], [b]) => b.length - a.length);
  const scrub = (s) => longest.reduce((t, [real, fake]) => t.replaceAll(real, fake), s);
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.slice(0, 3).map((x) => walk(x, key));
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
