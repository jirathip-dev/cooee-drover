// herdsman API v1's shapes the tabs read (herdsman assets/types/api.d.ts), and `parseState` / `parseQueue`, the contract
// checks the tabs run on `/api/v1/state` and `/api/v1/queue`: a field herdsman drops or retypes fails here, loudly, not
// as a blank tab.
export type Fleet = { name: string; repo: string; color: string; paused: boolean };
export type Queued = { fleet: string; issue: number; title?: string | null; state: string; blocked_by?: number | null };
export type Lane = {
  name: string;
  fleet?: string | null;
  issue?: number | null;
  title?: string | null;
  role: string;
  harness: string;
  model?: string | null;
  state: string;
  shown: string;
  tone: string;
  since: number;
};
export type Ask = {
  id: string;
  fleet: string;
  issue?: number | null;
  question: string;
  options: string[];
  recommend?: number | null;
  ts: number;
};
/** A Host tab row: a host, a service or an alert; `tone` is g, a, r or m. */
export type Row = { name: string; tone: string; detail: string; fix: string };
export type State = {
  seq: number;
  now: number;
  fleets: Fleet[];
  queue: Queued[];
  lanes: Lane[];
  asks: Ask[];
  hosts: Row[];
  services: Row[];
  alerts: Row[];
};

/** API v1's `queue` (#268), the fields the Queue tab reads: a card per fleet, the ones needing you first. */
export type QueueTab = { now: number; rw: boolean; mtime: string; error?: string | null; fleets: QueueCard[] };
export type QueueCard = {
  name: string;
  k: string;
  serial: string[];
  paths: string[];
  need: number;
  paused?: string | null;
  drive: { tone: string; line: string; meta: string[]; pass: boolean; acts: { who: string; words: string; code: string }[] };
  notes: string[];
  rows: QueueRow[];
  done: { issue: number; note: string; age: string; pr?: string | null }[];
  done_n: number;
  backlog?: { issues: Record<string, BacklogIssue>; ago: string } | null;
  config: { repo: string };
};
export type QueueRow = {
  issue: number;
  state: string;
  tone: string;
  t: number;
  queued: boolean;
  check: boolean;
  groups: string[];
  blocked_by?: number | null;
  title?: string | null;
  stage: { name: string; k: string; g: string; at: number; ok: boolean }[];
  lane: string;
  live: boolean;
  pr: PrLine;
  dead: boolean;
  notes: string[];
  decided?: string | null;
  ask?: Ask | null;
  open?: { ask: Ask; thread?: string | null; title?: string | null } | null;
  mv: boolean;
  up?: number | null;
  down?: number | null;
  lanes: { name: string; state: string; tone: string; ago: string; link: string }[];
};
export type PrLine = { pr?: number | null; run?: string | null; ci?: string | null; verdict?: string | null; vtone: string; rounds: number; form?: string | null };
export type BacklogIssue = { title: string; created: string; updated: string; labels: string[]; ac: boolean; pr: boolean };
/** A POST's answer: `code` OK, a `REFUSED` code or ERROR; `message` the line to show. */
export type Reply = { ok: boolean; code: string; message: string };

/**
 * A contract: a kind (`string`, `number`, `boolean`, `?` nullable), `[spec]` a list, `{field: spec}` an object
 * (with `"?": ""` nullable, `"*"` every value of a map).
 */
type Spec = string | Spec[] | { [k: string]: Spec };
const ASK = { id: "string", fleet: "string", issue: "number?", question: "string", options: ["string"], recommend: "number?", ts: "number" };
const ROW = { name: "string", tone: "string", detail: "string", fix: "string" };
const STATE = {
  seq: "number", now: "number",
  fleets: [{ name: "string", repo: "string", color: "string", paused: "boolean" }],
  queue: [{ fleet: "string", issue: "number", title: "string?", state: "string", blocked_by: "number?" }],
  lanes: [{
    name: "string", fleet: "string?", issue: "number?", title: "string?", role: "string", harness: "string",
    model: "string?", state: "string", shown: "string", tone: "string", since: "number",
  }],
  asks: [ASK], hosts: [ROW], services: [ROW], alerts: [ROW],
};
const QUEUE = {
  now: "number", rw: "boolean", mtime: "string", error: "string?",
  fleets: [{
    name: "string", k: "string", serial: ["string"], paths: ["string"], need: "number", paused: "string?",
    drive: { tone: "string", line: "string", meta: ["string"], pass: "boolean", acts: [{ who: "string", words: "string", code: "string" }] },
    notes: ["string"], done: [{ issue: "number", note: "string", age: "string", pr: "string?" }], done_n: "number",
    backlog: { "?": "", ago: "string", issues: { "*": { title: "string", created: "string", updated: "string", labels: ["string"], ac: "boolean", pr: "boolean" } } },
    config: { repo: "string" },
    rows: [{
      issue: "number", state: "string", tone: "string", t: "number", queued: "boolean", check: "boolean", groups: ["string"],
      blocked_by: "number?", title: "string?", stage: [{ name: "string", k: "string", g: "string", at: "number", ok: "boolean" }],
      lane: "string", live: "boolean", dead: "boolean", notes: ["string"], decided: "string?", mv: "boolean", up: "number?", down: "number?",
      pr: { pr: "number?", run: "string?", ci: "string?", verdict: "string?", vtone: "string", rounds: "number", form: "string?" },
      ask: { "?": "", ...ASK }, open: { "?": "", ask: ASK, thread: "string?", title: "string?" },
      lanes: [{ name: "string", state: "string", tone: "string", ago: "string", link: "string" }],
    }],
  }],
};

function fits(v: unknown, s: Spec, at: string): string | null {
  if (typeof s === "string") return (s.endsWith("?") ? v == null || typeof v === s.slice(0, -1) : typeof v === s) ? null : at;
  if (Array.isArray(s)) return Array.isArray(v) ? v.reduce((e: string | null, x, i) => e ?? fits(x, s[0], `${at}[${i}]`), null) : at;
  if (v == null && "?" in s) return null;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return at || "the top";
  const o = v as Record<string, unknown>, dot = (k: string) => (at ? `${at}.${k}` : k);
  if ("*" in s) return Object.keys(o).reduce((e: string | null, k) => e ?? fits(o[k], s["*"], dot(k)), null);
  return Object.keys(s).reduce((e: string | null, k) => e ?? (k === "?" ? null : fits(o[k], s[k], dot(k))), null);
}

/** `json` as herdsman's `/api/v1/<path>` answer, or an error naming the first field that breaks the contract. */
function parse<T>(path: string, spec: Spec, json: unknown): T {
  const at = fits(json, spec, "");
  if (at != null) throw new Error(`herdsman /api/v1/${path} broke the contract at ${at}`);
  return json as T;
}

export const parseState = (json: unknown): State => parse("state", STATE, json);
export const parseQueue = (json: unknown): QueueTab => parse("queue", QUEUE, json);
