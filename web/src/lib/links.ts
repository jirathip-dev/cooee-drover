// Cross-tab links: a lane is `#lane/<agent>` on drover-lanes, an ask `#ask/<id>` on drover-asks (cooee's `/p/<name>`).
export type Route = { kind: "lane" | "ask"; id: string };

export const laneHref = (agent: string): string => `/p/drover-lanes#lane/${encodeURIComponent(agent)}`;
export const askHref = (id: string): string => `/p/drover-asks#ask/${encodeURIComponent(id)}`;

/** The route a tab's `location.hash` names, if any. */
export function route(hash: string): Route | null {
  const m = /^#(lane|ask)\/(.+)$/.exec(hash);
  return m ? { kind: m[1] as Route["kind"], id: decodeURIComponent(m[2]) } : null;
}
