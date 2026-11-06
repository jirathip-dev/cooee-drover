// The tabs' herdsman client: every call goes through `cooee.fetch` to this backend, which forwards `/api/v1/*`.
import { parseQueue, parseState, type QueueTab, type Reply, type State } from "./types.ts";

export async function get(path: string): Promise<unknown> {
  const r = await cooee.fetch(`/api/v1/${path}`);
  if (!r.ok) throw new Error(`herdsman /api/v1/${path} answered ${r.status}: ${r.text}`);
  return JSON.parse(r.text);
}

export const state = async (): Promise<State> => parseState(await get("state"));
export const queue = async (): Promise<QueueTab> => parseQueue(await get("queue"));

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
