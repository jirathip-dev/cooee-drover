// The tabs' herdsman client: every call goes through `cooee.fetch` to this backend, which forwards `/api/v1/*`.
import { parseEvents, parseNeeds, parseQueue, parseState, type Events, type NeedsTab, type QueueTab, type Reply, type State } from "./types.ts";

export async function get(path: string): Promise<unknown> {
  const r = await cooee.fetch(`/api/v1/${path}`);
  if (!r.ok) throw new Error(`herdsman /api/v1/${path} answered ${r.status}: ${r.text}`);
  return JSON.parse(r.text);
}

export const state = async (): Promise<State> => parseState(await get("state"));
export const queue = async (): Promise<QueueTab> => parseQueue(await get("queue"));
export const needs = async (): Promise<NeedsTab> => parseNeeds(await get("needs"));
export const events = async (since: number): Promise<Events> => parseEvents(await get(`events?since=${since}`));

/** #412 #417: a design PNG or verify screenshot (`/design/…`, `/shot/…`) as the backend's `data:` URL, else null. */
export async function image(path: string): Promise<string | null> {
  const r = await cooee.fetch(path);
  return r.ok && r.text.startsWith("data:image/") ? r.text : null;
}

/** Form op `op` (`mv`, `pause`, `drive`, …) with its fields; herdsman's answer, or the failure as one. */
export async function post(op: string, fields: Record<string, string>): Promise<Reply> {
  const body = new URLSearchParams(fields).toString();
  const r = await cooee.fetch(`/api/v1/${op}`, { method: "POST", type: "application/x-www-form-urlencoded", body });
  try {
    return JSON.parse(r.text) as Reply;
  } catch {
    return { ok: false, code: "ERROR", message: `${op} answered ${r.status}: ${r.text}` };
  }
}
