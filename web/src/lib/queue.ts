// The drover-queue tab (herdsman#553 rows 36-48), drawn from API v1's `queue` as a tree of `h` nodes: pure, so the
// tests tap it under node. One repo at a time (chips, swipe, [all]); a fleet's card in its colour (paused: one line),
// its drive line, rows grouped needs you / in progress / queued, blocked chains as a tree (folded to one row in the
// queue), the open card (stage chips, lane, links, ask, ▲/▼, lanes), done today, the backlog and the [?] legend.
import { post, queue } from "./api.ts";
import { h, type El, type Kid } from "./dom.ts";
import { laneHref, threadHref } from "./links.ts";
import type { Ask, QueueCard, QueueRow, QueueTab } from "./types.ts";

/** The tab's own state: the repo picked, what is open, a fleet's pending op, the last answer, each backlog's picks. */
export type Bl = { q: string; on: string[]; label: string; ticks: number[] };
export type UI = { repo: string; open: Set<string>; busy: Record<string, string>; msg: [string, string]; bl: Record<string, Bl>; text: Record<string, string> };

/** #115: what each state word means: the legend sheet and every state word's title. */
export const HINT: Record<string, string> = {
  queued: "waiting its turn", impl: "being built", "review(n)": "being checked, round n",
  "fix(n)": "fixing review findings, round n", ready: "passed, waiting to merge", merged: "merged into staging",
  parked: "lane closed, its work saved on the PR", dead: "lane gone with unsaved work", "needs you": "waiting for your answer",
  working: "its lane is running", idle: "its lane waits for a next step", done: "its lane finished its turn",
};
const DOTS = ["● a lane is on it", "○ waiting", "✓ ready", "! needs you"];
const word = (s: string) => {
  const w = s.trim().split(/[\s·]/)[0].replace(/\(\d+\)/, "(n)");
  return /^(needs-human|blocked|⏸)/.test(w) ? "needs you" : w;
};
export const hint = (s: string): string => (HINT[word(s)] ? `${word(s)} = ${HINT[word(s)]}` : "");

/** #367: a row's group, and its time in one unit style. */
const GROUPS = { need: "needs you", prog: "in progress", queue: "queued" };
export const group = (s: string): keyof typeof GROUPS =>
  /^(needs-human|⏸)/.test(s) ? "need" : /^(impl|review|fix|ready|update|dead|parked)/.test(s) ? "prog" : "queue";
export const dur = (t: number): string =>
  t < 60 ? `${t}s` : t < 3600 ? `${Math.floor(t / 60)}m` : t < 86400 ? `${Math.floor(t / 3600)}h ${Math.floor((t % 3600) / 60)}m`
    : `${Math.floor(t / 86400)}d ${Math.floor((t % 86400) / 3600)}h`;
const phase = (s: string) => s.replace(/^⏸\s*/, "").split(/[\s(:]/)[0];

/** #115: a group's rows as a tree: a row blocked by a row in the group hangs off it, depth-first in queue order. */
export type Node = { r: QueueRow; depth: number; last: boolean; up: boolean };
export function tree(rows: QueueRow[]): Node[] {
  const by = new Map(rows.map((r) => [r.issue, r]));
  // A blocker loop (a → b → a) draws its rows as roots.
  const par = (r: QueueRow) => {
    const seen = new Set([r]);
    let x = by.get(r.blocked_by ?? -1);
    while (x && !seen.has(x)) (seen.add(x), (x = by.get(x.blocked_by ?? -1)));
    return x ? undefined : by.get(r.blocked_by ?? -1);
  };
  const kids = new Map(rows.map((r) => [r, [] as QueueRow[]])), roots: QueueRow[] = [];
  for (const r of rows) (par(r) ? kids.get(par(r)!)! : roots).push(r);
  const out: Node[] = [];
  const walk = (list: QueueRow[], depth: number) =>
    list.forEach((r, i) => {
      out.push({ r, depth, last: i === list.length - 1, up: !!par(r) });
      walk(kids.get(r)!, depth + 1);
    });
  walk(roots, 0);
  return out;
}

/** #365: a backlog's rows newest first and the ones its picks show (label, every quick filter, every search word). */
const BQ: [string, string][] = [["new", "new"], ["30", ">30 days"], ["90", ">90 days"], ["ac", "has AC"], ["pr", "in a closed PR"]];
type BRow = { n: number; title: string; labels: string[]; ac: boolean; pr: boolean; age: number; stale: boolean };
const BF: Record<string, (d: BRow) => boolean> = {
  new: (d) => d.age < 7 * 86400, 30: (d) => d.age > 30 * 86400, 90: (d) => d.age > 90 * 86400, ac: (d) => d.ac, pr: (d) => d.pr,
};
export function backlog(c: QueueCard, now: number, s: Bl): { all: BRow[]; shown: BRow[] } {
  const all = Object.entries(c.backlog?.issues ?? {}).map(([n, i]) => ({
    n: +n, title: i.title, labels: i.labels, ac: i.ac, pr: i.pr,
    age: Math.max(0, now - Date.parse(i.created) / 1000), stale: now - Date.parse(i.updated) / 1000 > 90 * 86400,
  })).sort((a, b) => b.n - a.n);
  const pass = (d: BRow) => (!s.label || d.labels.includes(s.label)) && s.on.every((k) => BF[k](d)) &&
    s.q.toLowerCase().split(/\s+/).every((w) => `#${d.n} ${d.title} ${d.labels.join(" ")}`.toLowerCase().includes(w));
  return { all, shown: all.filter(pass) };
}

const gh = (c: QueueCard, p: string) => `https://github.com/${c.config.repo}/${p}`;
const a = (href: string, text: string, cls = "") => h("a", { href, target: "_top", class: cls }, text);
const span = (cls: string, ...k: (Kid | false | null)[]) => h("span", { class: cls }, ...k);

/**
 * The tab: `draw` gets the tree after every change. `load` reads herdsman's queue; a tap posts a form op with the
 * page's `mtime`, shows herdsman's answer and reads the queue again.
 */
export function queueTab(draw: (kids: Kid[]) => void) {
  let d: QueueTab | null = null, err = "";
  const ui: UI = { repo: "", open: new Set(), busy: {}, msg: ["", ""], bl: {}, text: {} };
  const redraw = () => draw(d ? view(d) : [h("p", { class: "r" }, err || "loading…")]);
  const load = async () => {
    try {
      d = await queue();
    } catch (e) {
      (d = null), (err = String(e));
    }
    redraw();
  };
  const toggle = (k: string) => () => (ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k), redraw());
  const op = (fleet: string, name: string, f: Record<string, string> = {}, busy = "") => async () => {
    if (busy) (ui.busy[fleet] = busy), redraw();
    const r = await post(name, { op: name, fleet, mtime: d?.mtime ?? "", ...f });
    delete ui.busy[fleet];
    ui.msg = [r.ok ? "g" : "r", r.ok ? r.message : `${r.code}: ${r.message}`];
    await load();
  };
  const names = () => [...(d?.fleets ?? []).map((c) => c.name), "all"];
  const pick = (name: string) => () => ((ui.repo = name), redraw());
  /** #367: a sideways swipe or ←/→: the next (`k` 1) or previous (-1) repo. */
  const step = (k: number) => {
    const ns = names(), i = ns.indexOf(picked());
    pick(ns[(((i + k) % ns.length) + ns.length) % ns.length])();
  };
  const picked = () => (names().includes(ui.repo) ? ui.repo : names()[0]);

  // #173: `○ ─ ▲ impl ─ ◆ rev ─ ◫ gates ─ ✓ merge`, the current stage lit.
  const stages = (r: QueueRow) => {
    const chips = r.stage.map((s) =>
      span(s.at < 0 ? "pt dn" : s.at > 0 ? "pt" : "pt on", `${s.g} ${s.name}`, s.ok && span("g", " ✓")));
    return span("ps", ...[span("pt dn", "○"), ...chips, span("pt", "✓ merge")].flatMap((c, i) => (i ? [" ─ ", c] : [c])));
  };
  // #169: `[issue] [PR #11] [checks] · CI ✓ · rev PASS r1`.
  const links = (c: QueueCard, r: QueueRow) => {
    const p = r.pr, l: Kid[] = [a(gh(c, `issues/${r.issue}`), "[issue]")];
    if (p.pr != null) l.push(" ", a(gh(c, `pull/${p.pr}`), `[PR #${p.pr}]`), " ", a(gh(c, `pull/${p.pr}/checks`), "[checks]"));
    else if (p.run != null) l.push(" ", a(p.run, "[checks]"));
    if (p.ci == null) l.push(" · no PR read yet");
    else l.push(" · CI ", span(p.ci === "failed" ? "r" : p.ci === "green" ? "g" : "a", p.ci === "green" ? "✓" : p.ci === "failed" ? "✗" : "…"));
    if (p.verdict != null) l.push(" · rev ", span(p.vtone, p.verdict), ` r${p.rounds}`);
    if (p.form != null) l.push(span("a", ` · not counted · form ${p.form}`));
    return h("p", {}, ...l);
  };
  // An ask's answer: option buttons (recommended first) and a free-text box.
  const answer = (x: Ask, send: string) => {
    const opts = x.options.map((o, i) => [o, i + 1] as const).sort((p, q) => +(p[1] !== x.recommend) - +(q[1] !== x.recommend));
    const go = (f: Record<string, string>) => op(x.fleet, "answer", { id: x.id, ...f });
    return h("p", { class: "btns" },
      ...opts.map(([o, n]) => h("button", { on: go({ choice: String(n) }) }, `${n}. ${o}${n === x.recommend ? " (recommended)" : ""}`)),
      h("input", { id: `t-${x.id}`, placeholder: "or type an answer", value: ui.text[x.id] ?? "", oninput: (v) => (ui.text[x.id] = v) }),
      h("button", { on: () => go({ text: ui.text[x.id] ?? "" })() }, send));
  };
  const head = (t: string) => h("p", { class: "ch" }, t);
  // The open card (#218): STATUS (stages, lane, notes, ask, ▲/▼), LINKS, LANES newest first, HISTORY (+N older).
  const card = (c: QueueCard, r: QueueRow) => {
    const key = `${c.name}#${r.issue}`, lane = (n: string, how: string, text: Kid[]) =>
      how ? h("a", { href: laneHref(n), target: "_top", class: "ql" }, ...text) : span("ql m", ...text);
    const ls = r.lanes.map((l) => lane(l.name, l.link, [span(l.tone, l.state === "working" ? "● " : "○ "), l.name, span("m", ` ${l.state} ${l.ago}`)]));
    const mv = (label: string, k: string, to: number | null | undefined) =>
      to != null && h("button", { on: op(c.name, "mv", { issue: String(r.issue), [k]: String(to) }), "aria-label": `move ${label}` }, label === "up" ? "▲" : "▼");
    return h("div", { class: "cd" },
      head("STATUS"),
      r.stage.length > 0 && h("p", {}, stages(r)),
      r.lane && h("p", {}, r.live ? lane(r.lane, "live", [r.lane]) : r.lane),
      r.dead && h("p", { class: "r" }, "dead: the log has this lane open, herdr has no such agent"),
      r.blocked_by != null && h("p", { class: "r" }, `blocked by #${r.blocked_by}`),
      r.check && h("p", { class: "m" }, "needs-check: from the backlog, spec not checked"),
      ...r.notes.map((x) => h("p", { class: "r" }, x)),
      r.open && h("p", {}, h("b", {}, "asks: "), r.open.ask.question,
        r.open.thread != null && span("m", " · ", a(threadHref(r.open.thread), `asked in ${r.open.title || r.open.thread} · ${r.open.thread}`))),
      r.open && d!.rw && answer(r.open.ask, "Send"),
      r.decided != null && h("p", {}, `decided by default: ${r.decided}`),
      r.decided != null && r.ask && d!.rw && answer(r.ask, "change"),
      r.mv && d!.rw && h("p", { class: "btns" }, mv("up", "before", r.up), mv("down", "after", r.down)),
      head("LINKS"),
      links(c, r),
      ls.length > 0 && head(`LANES (${ls.length})`),
      ...ls.slice(0, 5),
      ls.length > 5 && h("button", { class: "lk", on: toggle(`old:${key}`) }, `HISTORY +${ls.length - 5} older`),
      ...(ui.open.has(`old:${key}`) ? ls.slice(5) : []));
  };
  // A row's line: tree gutter and dot, #N, state (its hint the title), time or place, title, 🔒 and `! #b` tags.
  const row = (c: QueueCard, n: Node, when: string): El => {
    const { r } = n, key = `${c.name}#${r.issue}`, s = r.state;
    const dot = r.tone === "r" || group(s) === "need" ? "!" : s === "ready" ? "✓" : /^(impl|review|fix)/.test(s) ? "●" : "○";
    const gutter = n.depth ? `${"  ".repeat(Math.min(n.depth, 2) - 1)}${n.last || n.depth > 2 ? "└─" : "├─"}` : "";
    const line = h("div", { class: "rl", on: toggle(`row:${key}`) },
      span("gt", gutter, span(r.tone, dot)), ` #${r.issue} `, h("span", { class: r.tone, title: hint(s) }, s), " ",
      span("m", when), " ", span("tl", r.title ?? ""),
      ...r.groups.map((g) => h("span", { class: "tag m", title: "serial: one lane at a time" }, `🔒${g}`)),
      r.blocked_by != null && !n.up && span("tag r", `! #${r.blocked_by}`),
      n.depth > 2 && span("tag m", `after #${r.blocked_by}`),
      r.check && span("tag m", "needs-check"));
    return h("div", { class: `q d${Math.min(n.depth, 2)}` }, line, ui.open.has(`row:${key}`) && card(c, r));
  };
  // #367 #391: the queued group: each root and its blocked steps one item, a chain one row (`chain · N`, its place,
  // `#first → #last · next: #b (state)`); its place numbers; past 5, `+ N more` opens the rest in place.
  const queued = (c: QueueCard, ns: Node[]) => {
    const items: Node[][] = [];
    for (const n of ns) n.depth && items.length ? items.at(-1)!.push(n) : items.push([n]);
    const tops = items.map((it, i) => {
      if (it.length === 1) return row(c, it[0], `#${i + 1}`);
      const [f] = it, key = `chain:${c.name}#${f.r.issue}`, nb = f.r.blocked_by ?? f.r.issue;
      const nx = c.rows.find((r) => r.issue === nb), ph = nx ? ` (${group(nx.state) === "prog" ? "in " : ""}${phase(nx.state)})` : "";
      return h("div", { class: "q qc" },
        h("div", { class: "rl", on: toggle(key) }, span("gt", span(f.r.tone, "○")), ` #${f.r.issue} `, span("a", `chain · ${it.length}`),
          " ", span("m", `#${i + 1}`), " ", span("tl", f.r.title ?? ""),
          h("div", { class: "m cst" }, `#${f.r.issue} → #${it.at(-1)!.r.issue} · next: #${nb}${ph}`)),
        ...(ui.open.has(key) ? it.map((n) => row(c, n, "")) : []));
    });
    const more = `more:${c.name}`;
    if (tops.length <= 5) return tops;
    return [...tops.slice(0, 5), h("button", { class: "lk", on: toggle(more) }, `+ ${tops.length - 5} more`), ...(ui.open.has(more) ? tops.slice(5) : [])];
  };
  const groups = (c: QueueCard, only?: "need") => {
    const gs = { need: [] as QueueRow[], prog: [] as QueueRow[], queue: [] as QueueRow[] };
    for (const r of c.rows) gs[group(r.state)].push(r);
    return (Object.keys(GROUPS) as (keyof typeof GROUPS)[]).filter((g) => gs[g].length && (!only || g === only)).map((g) => {
      const ns = tree(gs[g]), t = (r: QueueRow) => (r.t ? dur(Math.max(0, d!.now - r.t)) : "");
      const rows = g === "queue" ? queued(c, ns) : ns.map((n) => row(c, n, g === "prog" ? `in ${phase(n.r.state)} ${t(n.r)}` : t(n.r)));
      return h("div", { class: "qg" }, h("h3", {}, `${GROUPS[g]} (${gs[g].length})`), ...rows);
    });
  };
  // #166: the drive line; a tap lists its meta lines, then each action in words, a tap on one its raw code.
  const drive = (c: QueueCard) => {
    const v = c.drive, k = `drive:${c.name}`, busy = ui.busy[c.name];
    return h("div", { class: "dp" }, h("div", { class: busy ? "a" : v.tone, on: toggle(k) }, `● ${busy ?? v.line}`),
      ...(ui.open.has(k) ? [
        ...v.meta.map((m) => h("p", { class: "m" }, m)),
        !v.acts.length && v.pass && h("p", {}, "nothing was due"),
        ...v.acts.flatMap((x, i) => [h("p", { class: "lk", on: toggle(`${k}:${i}`) }, `${x.who}: ${x.words}`), ui.open.has(`${k}:${i}`) && h("code", {}, x.code)]),
      ] : []));
  };
  // #365: search, quick filters, a label, ticks; [queue N] queues the ticked (in tick order) as needs-check.
  const bl = (c: QueueCard) => {
    const s = (ui.bl[c.name] ??= { q: "", on: [], label: "", ticks: [] }), k = `bl:${c.name}`, { all, shown } = backlog(c, d!.now, s);
    s.ticks = s.ticks.filter((n) => all.some((r) => r.n === n));
    const labels = [...new Set(all.flatMap((r) => r.labels))].sort(), set = (f: Partial<Bl>) => (Object.assign(s, f), redraw());
    const tick = (n: number) => () => set({ ticks: s.ticks.includes(n) ? s.ticks.filter((x) => x !== n) : [...s.ticks, n] });
    return h("div", { class: "bl" }, h("div", { class: "lk", on: toggle(k) }, `backlog (${shown.length === all.length ? all.length : `${shown.length} of ${all.length}`})`),
      ...(ui.open.has(k) ? [
        h("input", { id: `q-${c.name}`, type: "search", placeholder: "search #, title, label", value: s.q, oninput: (v) => set({ q: v }) }),
        h("p", { class: "btns" }, ...BQ.map(([f, l]) => h("button", { "aria-pressed": String(s.on.includes(f)), on: () => set({ on: s.on.includes(f) ? s.on.filter((x) => x !== f) : [...s.on, f] }) }, l)),
          h("select", { "aria-label": "label", oninput: (v) => set({ label: v }) }, h("option", { value: "" }, "any label"),
            ...labels.map((l) => h("option", l === s.label ? { selected: "" } : {}, l)))),
        ...shown.map((r) => h("label", { class: "bi" }, h("input", { type: "checkbox", value: String(r.n), on: tick(r.n), ...(s.ticks.includes(r.n) ? { checked: "" } : {}) }),
          ` #${r.n} `, span("tl", r.title), span("m", ` ${r.labels.join(" ")}`), r.stale && span("tag m", "stale"), span("m", ` ${dur(Math.round(r.age))}`))),
        h("p", { class: "m" }, `read ${c.backlog!.ago} ago · [Drive now] reads it again`),
        s.ticks.length > 0 && d!.rw && h("button", { on: () => op(c.name, "bqueue", { issues: s.ticks.splice(0).join(",") })() }, `queue ${s.ticks.length}`),
      ] : []));
  };
  // #162: a fleet's card in its colour, needing you first; a paused fleet folds to one line (a tap opens it).
  const fleet = (c: QueueCard, all: boolean) => {
    const button = (o: string, label: string, busy = "") => d!.rw && h("button", { on: op(c.name, o, {}, busy) }, label);
    const need = c.need > 0 && span("tag r", `! ${c.need} need you`), k = `card:${c.name}`;
    const style = `border-left-color:var(--${c.k})`, name = h("b", { style: `color:var(--${c.k})` }, c.name);
    if (all) return h("div", { class: "fc", style }, h("div", { class: "fh" }, name, need), ...groups(c, "need"));
    const done = `done:${c.name}`, body = [
      ...groups(c),
      !c.rows.length && h("p", { class: "m" }, "no open work"),
      c.done_n > 0 && h("div", { class: "lk", on: toggle(done) }, `done today: ${c.done_n}`),
      ...(ui.open.has(done) ? c.done.map((x) => h("p", {}, `#${x.issue} `, span("g", x.note), ` ${x.age} `, x.pr != null && a(gh(c, `pull/${x.pr}`), `PR #${x.pr}`))) : []),
      c.backlog && bl(c),
    ];
    if (c.paused != null)
      return h("div", { class: "fc off", style }, h("div", { class: "fh", on: toggle(k) }, name, span("m", ` ● ${c.paused}`), need, button("resume", "Resume")),
        ...(ui.open.has(k) ? body : []));
    return h("div", { class: "fc", style },
      h("div", { class: "fh" }, name, need, h("span", { class: "btns" }, button("drive", "Drive now", "⟳ driving…"), button("pause", "Pause"))),
      drive(c), ...c.notes.map((x) => h("p", { class: "r" }, x)), ...body);
  };
  // #115 #294: the [?] legend: a line per state, the dots, and each fleet's serial lock with the paths it guards.
  const legend = () => h("div", { class: "sheet" }, h("p", {}, h("b", {}, "what the marks mean "), h("button", { on: toggle("legend") }, "close")),
    ...Object.entries(HINT).map(([w, t]) => h("p", {}, `${w} = ${t}`)), ...DOTS.map((t) => h("p", {}, t)),
    ...d!.fleets.flatMap((c) => c.serial.map((g, i) => h("p", {}, `🔒${g} one at a time: touches ${c.paths[i] ?? ""}`))));
  const view = (d: QueueTab): Kid[] => {
    if (d.error != null) return [h("p", { class: "r" }, d.error)];
    const p = picked(), needs = (c: QueueCard) => c.rows.filter((r) => group(r.state) === "need").length;
    const chip = (name: string, n: number, dot: boolean, k = "") =>
      h("button", { class: "chip", "aria-pressed": String(name === p), style: k && `border-color:var(--${k})`, on: pick(name) }, `${name} ${n}`, dot && span("r", " ●"));
    const total = d.fleets.reduce((n, c) => n + needs(c), 0);
    return h("main", {},
      h("p", { class: "chips" }, ...d.fleets.map((c) => chip(c.name, c.rows.length, c.need > 0 || needs(c) > 0, c.k)), chip("all", total, total > 0),
        h("button", { class: "chip", "aria-label": "legend", on: toggle("legend") }, "?")),
      ui.msg[1] && h("p", { class: ui.msg[0] }, ui.msg[1]),
      ui.open.has("legend") && legend(),
      ...(p === "all" ? d.fleets.filter(needs).map((c) => fleet(c, true)) : d.fleets.filter((c) => c.name === p).map((c) => fleet(c, false))),
    ).k;
  };
  return { load, step };
}

export const CSS = `
body{font:15px system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:8px}
a{color:var(--link)}button{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--edge);border-radius:6px;padding:2px 8px;margin:2px}
button[aria-pressed=true]{background:var(--edge)}input{font:inherit;margin:2px}
.chips{display:flex;flex-wrap:wrap;gap:2px}
.fc{background:var(--card);border:1px solid var(--edge);border-left:4px solid;border-radius:8px;padding:8px;margin:8px 0}
.fh{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.fh .btns{margin-left:auto}
h3{font-size:.9em;color:var(--mute);margin:10px 0 4px}
.rl,.lk,.dp>div{cursor:pointer}.q{padding:3px 0;border-top:1px solid var(--edge)}.gt{white-space:pre;font-family:monospace}
.tl{color:var(--fg)}.tag{font-size:.85em;margin-left:4px}.cd{padding:4px 0 4px 12px}.cd p{margin:3px 0}.ch{font-size:.8em;color:var(--mute)}
.pt{color:var(--mute)}.pt.on{color:var(--fg);font-weight:bold}.pt.dn{opacity:.6}.ql{display:block}
.sheet{background:var(--card);border:1px solid var(--edge);border-radius:8px;padding:8px}.bi{display:block}
code{display:block;white-space:pre-wrap;font-size:.85em}
.g{color:var(--g)}.a{color:var(--a)}.r{color:var(--r)}.m{color:var(--mute)}
`;
