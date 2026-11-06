// Each tab's view of herdsman's state: titled lists of rows, drawn by `theme.render`.
import { laneHref } from "./links.ts";
import type { Row, State } from "./types.ts";

export type Item = { text: string; tone?: string; href?: string };
export type Section = { title: string; items: Item[] };

/** drover-lanes: each lane, as its Lanes row says it. */
export const lanesView = (s: State): Section[] => [
  { title: "Lanes", items: s.lanes.map((l) => ({ text: `${l.name} · ${l.shown}`, tone: l.tone, href: laneHref(l.name) })) },
];

const rows = (title: string, r: Row[]): Section => ({
  title,
  items: r.map((x) => ({ text: `${x.name} · ${x.detail}`, tone: x.tone })),
});

/** drover-system: hosts, services and alerts. */
export const systemView = (s: State): Section[] => [
  rows("Hosts", s.hosts),
  rows("Services", s.services),
  rows("Alerts", s.alerts),
];
