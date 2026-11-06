// Each tab's view of herdsman's state: titled lists of rows, drawn by `theme.render`.
import { askHref, laneHref } from "./links.ts";
import type { State } from "./types.ts";

export type Item = { text: string; tone?: string; href?: string };
export type Section = { title: string; items: Item[] };

/** drover-lanes: each lane, as its Lanes row says it. */
export const lanesView = (s: State): Section[] => [
  { title: "Lanes", items: s.lanes.map((l) => ({ text: `${l.name} · ${l.shown}`, tone: l.tone, href: laneHref(l.name) })) },
];

/** drover-asks: the open asks. */
export const asksView = (s: State): Section[] => [
  { title: "Asks", items: s.asks.map((a) => ({ text: `${a.id} · ${a.fleet} · ${a.question}`, href: askHref(a.id) })) },
];
