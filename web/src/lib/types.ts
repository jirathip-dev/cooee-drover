// herdsman API v1's shapes the tabs read (herdsman assets/types/api.d.ts), and `parseState`, the contract check every
// tab runs on `/api/v1/state`: a field herdsman drops or retypes fails here, loudly, not as a blank tab.
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

type Kind = "string" | "number" | "boolean" | "string?" | "number?" | "string[]";
const FLEET = { name: "string", repo: "string", color: "string", paused: "boolean" } as const;
const QUEUED = { fleet: "string", issue: "number", title: "string?", state: "string", blocked_by: "number?" } as const;
const LANE = {
  name: "string", fleet: "string?", issue: "number?", title: "string?", role: "string", harness: "string",
  model: "string?", state: "string", shown: "string", tone: "string", since: "number",
} as const;
const ASK = {
  id: "string", fleet: "string", issue: "number?", question: "string", options: "string[]", recommend: "number?",
  ts: "number",
} as const;
const ROW = { name: "string", tone: "string", detail: "string", fix: "string" } as const;
const LISTS = { fleets: FLEET, queue: QUEUED, lanes: LANE, asks: ASK, hosts: ROW, services: ROW, alerts: ROW };

function fits(v: unknown, k: Kind): boolean {
  if (k.endsWith("?")) return v == null || typeof v === k.slice(0, -1);
  if (k === "string[]") return Array.isArray(v) && v.every((s) => typeof s === "string");
  return typeof v === k;
}

/** `json` as a `State`, or an error naming the first field that breaks the contract. */
export function parseState(json: unknown): State {
  const o = json as Record<string, unknown>;
  const bad = (at: string) => new Error(`herdsman /api/v1/state broke the contract at ${at}`);
  if (typeof o !== "object" || o === null) throw bad("the top");
  for (const k of ["seq", "now"]) if (typeof o[k] !== "number") throw bad(k);
  for (const [list, shape] of Object.entries(LISTS)) {
    const rows = o[list];
    if (!Array.isArray(rows)) throw bad(list);
    rows.forEach((r: Record<string, unknown>, i) => {
      for (const [f, k] of Object.entries(shape)) if (!fits(r?.[f], k)) throw bad(`${list}[${i}].${f}`);
    });
  }
  return o as State;
}
