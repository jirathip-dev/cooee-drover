// The tabs' herdsman client: every call goes through `cooee.fetch` to this backend, which forwards `/api/v1/*`.
import { parseState, type State } from "./types.ts";

export async function get(path: string): Promise<unknown> {
  const r = await cooee.fetch(`/api/v1/${path}`);
  if (!r.ok) throw new Error(`herdsman /api/v1/${path} answered ${r.status}: ${r.text}`);
  return JSON.parse(r.text);
}

export const state = async (): Promise<State> => parseState(await get("state"));
