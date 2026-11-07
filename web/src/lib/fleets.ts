// The drover-fleets tab (herdsman#553 rows 75, 77, 80-85, as cooee-drover#5's amendment A keeps them), drawn from API
// v1's `queue` (each fleet's [config] sheet: settings, pipeline graph, role pickers, conductor), `host` (the hosts'
// lanes switch, fleet disk, notifiers), `state` and `events` (activity) as a tree of `h` nodes: pure, so the tests tap
// it under node. A destructive tap asks first; every tap shows herdsman's answer and reads it all again.
import { events, fleets as config, host, post, state } from "./api.ts";
import { h, late, strip, type Kid } from "./dom.ts";
import { dur } from "./queue.ts";
import type { Bar, Conductor, Ev, FleetsTab, HostTab, Pipe, RoleRow, State } from "./types.ts";

type Card = FleetsTab["fleets"][number];

/** The tab's own state: what is open, the last answer, [important], activity rows shown, the tap awaiting [yes], picks. */
export type UI = {
  open: Set<string>;
  msg: [string, string];
  imp: boolean;
  shown: number;
  sure: string;
  pick: Record<string, Record<string, string>>;
};

/** #170: noise a run folds into one `kind ×N` row (by kind, so a failure never shares a row with `clean`). */
const NOISE: Record<string, string> = {
  clean: "lanes cleaned",
  "push-sent": "alerts sent",
  "notify-failed": "alerts that never arrived",
};
const MON = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");

/** #170 #206: rows newest first, `imp` the important only; a run of one noise kind, or of the same words in one second, folds. */
export function fold(list: Ev[], imp: boolean): Ev[][] {
  const out: Ev[][] = [];
  for (const e of [...list].sort((a, b) => b.ts - a.ts || b.seq - a.seq)) {
    if (imp && !e.imp) continue;
    const p = out.at(-1)?.[0];
    if (p && p.fleet === e.fleet && (e.type in NOISE ? p.type === e.type : p.ts === e.ts && p.text === e.text))
      out.at(-1)!.push(e);
    else out.push([e]);
  }
  return out;
}

/** #266: an event's time group: now, 5m, 1h, earlier today, yesterday, then its date (`tz` the server's UTC offset). */
export function when(t: number, now: number, tz: number): string {
  const a = now - t,
    day = (x: number) => Math.floor((x + tz) / 86400);
  if (a < 300) return "now";
  if (a < 3600) return "5m";
  if (a < 7200) return "1h";
  if (day(t) === day(now)) return "earlier today";
  if (day(t) + 1 === day(now)) return "yesterday";
  const x = new Date(day(t) * 86_400_000);
  return `${MON[x.getUTCMonth()]} ${x.getUTCDate()}`;
}

/** The kids that show: a false, null or empty one drops. */
const some = (k: (Kid | false | null | undefined)[]): Kid[] => k.filter((x): x is Kid => !!x);
const span = (cls: string, ...k: (Kid | false | null | undefined)[]) => h("span", { class: cls }, ...k);
const list = (v: string[], sep = ", "): Kid => (v.length ? v.join(sep) : span("m", "none"));
const kv = (rows: [string, Kid][]) => h("dl", {}, ...rows.flatMap(([k, v]) => [h("dt", {}, k), h("dd", {}, v)]));
const group = (name: string, hint: string, ...k: (Kid | false | null | undefined)[]) =>
  h("div", { class: "cg" }, h("h3", {}, name, span("m", ` ${hint}`)), ...k);
const head = (t: string, meta = "") => h("h2", {}, t, meta && span("m", ` · ${meta}`));
const s = (n: number, w: string, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
/** #141: a 12-cell text gauge. */
const gauge = (b: Bar) => span(`bar ${b.t}`, `▕${"█".repeat(b.n)}${"░".repeat(Math.max(0, 12 - b.n))}▏`);

/** #173: a stage's glyph by kind, an outcome's colour. */
const G: Record<string, string> = { build: "▲", check: "◆", gate: "◫" };
const TONE: Record<string, string> = { PASS: "g", ok: "g", FAIL: "r", ci_red: "r", conflict: "a" };
/** #173: the Pipeline group: valid (or each broken rule with its fleet.toml line), then the stage graph top to bottom. */
export function pipeline(p: Pipe): Kid[] {
  const S = p.stages,
    spine = (i: number) => S[i + 1]?.name ?? "merge",
    main = (k: string) => (k === "build" ? "push" : k === "check" ? "PASS" : "ok");
  const ok = h(
    "p",
    {},
    span("g", "✓ valid"),
    ` · ${s(S.length, "stage")} (${S.map((x) => x.name).join(", ")})`,
    p.builtin && span("m", " · built-in"),
  );
  return [
    p.bad.length
      ? h(
          "p",
          { class: "r" },
          `BAD_PIPELINE · ${s(p.bad.length, "error")}: nothing moves for this fleet until fleet.toml is fixed`,
        )
      : ok,
    ...p.bad.map((b) => h("p", { class: "r" }, `✗ ${b.rule}: ${b.msg}`, span("m", ` fleet.toml:${b.line}`))),
    h(
      "div",
      { class: "pg" },
      h("p", {}, "○ ", h("b", {}, "queued"), span("m", ` ${p.queued} waiting`)),
      ...S.flatMap((x, i) => [
        h(
          "p",
          { class: "pn" },
          `${G[x.kind] ?? "!"} `,
          h("b", {}, x.name),
          span("m", ` ${x.kind === "gate" ? "gate · herdsman" : x.kind}`),
          x.here > 0 && span("tag m", `${x.here} here`),
        ),
        h(
          "p",
          { class: "pd m" },
          x.role
            ? `role ${x.role} · ${x.run ?? "not defined"}`
            : `CI ${p.required.join(" + ") || "green"} · PASS at head · mergeable`,
        ),
        ...Object.entries(x.next)
          .filter(([o, t]) => !(o === main(x.kind) && t === spine(i)))
          .map(([o, t]) => {
            const to = t.endsWith(":update") ? `update in ${t.split(":")[0]}` : t;
            return h(
              "p",
              { class: "pd" },
              span(TONE[o] ?? "", o),
              ` → ${to}${["FAIL", "conflict"].includes(o) && x.rounds != null ? ` · ≤${x.rounds} rounds, then park` : ""}`,
            );
          }),
      ]),
      h("p", {}, "✓ ", h("b", {}, "merge"), span("m", ` into ${p.into}`)),
      p.parked > 0 && h("p", { class: "m" }, `! parked ${p.parked}`),
    ),
  ];
}

/** The tab: `draw` gets the tree after every change; `load` reads herdsman's `queue`, `host`, `state` and newest events. */
export function fleetsTab(draw: (kids: Kid[]) => void) {
  let q: FleetsTab | null = null,
    hs: HostTab | null = null,
    st: State | null = null,
    ev: Ev[] = [],
    err: string[] = [],
    busy = true,
    slow = false;
  const ui: UI = { open: new Set(), msg: ["", ""], imp: false, shown: 100, sure: "", pick: {} };
  const redraw = () => draw(view());
  const got = <T>(r: PromiseSettledResult<T>): T | null =>
    r.status === "fulfilled"
      ? r.value
      : (err.push(r.reason instanceof Error ? r.reason.message : String(r.reason)), null);
  const load = async () => {
    const done = late((s) => ((slow = s), s && redraw()));
    err = [];
    const [a, b, c] = await Promise.allSettled([config(), host(), state()]);
    (q = got(a)), (hs = got(b)), (st = got(c));
    if (st) ev = got((await Promise.allSettled([events(Math.max(0, st.seq - 500), st.seq)]))[0])?.list ?? [];
    (busy = false), done();
    redraw();
  };
  const first = () => ev.reduce((m, e) => Math.min(m, e.seq), Infinity);
  /** #351: [older] shows 100 more rows, reading the 500 events before the oldest when the view runs out. */
  const older = async () => {
    ui.shown += 100;
    const f = first();
    if (fold(ev, ui.imp).length < ui.shown && f > 1 && f !== Infinity) {
      const e = await events(Math.max(0, f - 501), f - 1).catch((x: Error) => (err.push(x.message), null));
      if (e && !e.refresh) ev = [...e.list, ...ev];
    }
    redraw();
  };
  const toggle = (k: string) => () => (ui.open.has(k) ? ui.open.delete(k) : ui.open.add(k), redraw());
  const op = (name: string, f: Record<string, string>) => async () => {
    ui.sure = "";
    const r = await post(name, { op: name, ...f });
    ui.msg = [r.ok ? "g" : "r", r.ok ? r.message : `${r.code}: ${r.message}`];
    await load();
  };
  /** A destructive tap's button; tapped, its question with [yes] (the op) and [cancel]. */
  const sure = (key: string, label: string, ask: string, go: () => Promise<void>) =>
    ui.sure === key
      ? span(
          "sure",
          `${ask} `,
          h("button", { on: go }, "yes"),
          h("button", { on: () => ((ui.sure = ""), redraw()) }, "cancel"),
        )
      : h("button", { on: () => ((ui.sure = key), redraw()) }, label);

  // #2 #16: a role's harness, model and effort pickers (the effort list follows the harness), [Set] posts `set`.
  const role = (d: FleetsTab, c: Card, r: RoleRow) => {
    const g = c.config,
      p = (ui.pick[`${c.name}/${r.name}`] ??= {});
    const harness = p.harness ?? r.harness,
      model = p.model ?? r.model ?? "",
      effort = p.effort ?? r.effort ?? "";
    const top = h("p", {}, h("b", {}, r.name), span("m", ` ${r.profile}`));
    if (!d.rw)
      return h("div", { class: "role" }, top, h("p", {}, [r.harness, r.model, r.effort].filter(Boolean).join(" · ")));
    const efforts = g.harnesses.find((x) => x.name === harness)?.efforts ?? r.efforts;
    const pick = (k: string, cur: string, def: string, opts: string[], off = false) =>
      h(
        "select",
        { "aria-label": k, oninput: (v) => ((p[k] = v), redraw()), ...(off ? { disabled: "" } : {}) },
        !opts.includes(cur) && h("option", { value: "", selected: "" }, cur || `default (${def})`),
        ...opts.map((o) => h("option", o === cur ? { selected: "" } : {}, o)),
      );
    return h(
      "div",
      { class: "role" },
      top,
      h(
        "p",
        { class: "btns" },
        pick(
          "harness",
          harness,
          r.harness,
          g.harnesses.map((x) => x.name),
        ),
        pick("model", model, r.model_default, g.models, !g.models.length),
        pick("effort", efforts.includes(effort) ? effort : "", r.effort_default, efforts),
        h(
          "button",
          {
            on: op("set", {
              fleet: c.name,
              mtime: d.mtime,
              role: r.name,
              harness,
              model,
              effort: efforts.includes(effort) ? effort : "",
            }),
          },
          "Set",
        ),
      ),
      !g.models.length && h("p", { class: "m" }, "add models = [...] to fleet.toml to pick a model"),
    );
  };
  // #401: the fleet's conductor: a tap on a harness, model or effort writes it (`cond`).
  const conductor = (d: FleetsTab, c: Card, k: Conductor) => {
    const row = (key: string, cur: string | null | undefined, opts: string[]) =>
      h(
        "p",
        { class: "btns" },
        span("m", `${key} `),
        ...opts.map((o) =>
          h(
            "button",
            {
              "aria-pressed": String(cur === o),
              ...(d.rw ? { on: op("cond", { fleet: c.name, mtime: d.mtime, [key]: o }) } : { disabled: "" }),
            },
            o,
          ),
        ),
      );
    return [
      h("p", { class: "m" }, k.profile),
      row(
        "harness",
        k.harness,
        c.config.harnesses.map((x) => x.name),
      ),
      row("model", k.model, k.models),
      row("effort", k.effort, k.efforts),
    ];
  };
  // #162: a fleet's [config] sheet: GENERAL, Pipeline, LIMITS, ROLES, Conductor, ALERTS.
  const sheet = (d: FleetsTab, c: Card): Kid[] => {
    const g = c.config,
      edit = `edit ${g.path}`,
      cap = (n?: number | null) => (n == null ? "no cap" : String(n));
    return some([
      group(
        "General",
        edit,
        kv([
          ["repo", g.repo],
          ["local", g.local],
          ["integration", g.integration],
          ["default effort", g.effort ?? "unset → none"],
          ["colour", h("span", { style: `color:var(--${c.k})` }, `■ --${c.k} (${g.color_set ? "set" : "auto"})`)],
          ["env", list(g.env)],
        ]),
      ),
      group("Pipeline", g.builtin ? "built-in · edit fleet.toml" : edit, ...pipeline(g.pipe)),
      group(
        "Limits",
        edit,
        kv([
          ["review rounds", String(g.review_rounds)],
          ["update rounds", String(g.update_rounds)],
          ["stall after", `${g.stall_minutes} min`],
          ["ask default", `${g.ask_minutes} min`],
          ["max lanes", `impl ${cap(g.max_impl)} · rev ${cap(g.max_rev)}`],
          ["line cap", g.line_cap == null ? "none in ci/cap.toml" : String(g.line_cap)],
          ["serial", list(g.serial)],
          ["deny commands", list(g.deny)],
          ["required checks", g.required.length ? list(g.required) : "all"],
          ["merge label", g.merge_label ?? "none"],
        ]),
      ),
      group("Roles", "set: harness · model · effort", ...g.roles.map((r) => role(d, c, r))),
      g.conductor && group("Conductor", g.conductor.default ? "default: impl" : "set", ...conductor(d, c, g.conductor)),
      group(
        "Alerts",
        edit,
        kv([
          ["notify", g.notify.length ? list(g.notify, "; ") : "global only"],
          ["global", list(g.global, "; ")],
        ]),
      ),
    ]);
  };
  // #162 #483: a row per fleet in its colour opening to its sheet; fleet.toml unread: herdsman's own error, plainly.
  const fleets = (d: FleetsTab): Kid[] => [
    head(
      "FLEETS",
      d.error != null
        ? ""
        : `${s(d.fleets.length, "repo")}${d.fleets[0] ? ` · config ${d.fleets[0].config.path}` : ""}`,
    ),
    ...(d.error != null
      ? [h("p", { class: "r" }, d.error)]
      : d.fleets.map((c) => {
          const k = `fleet:${c.name}`,
            roles = c.config.roles.map((r) => r.name).join(" · ");
          return h(
            "div",
            { class: "fc", style: `border-left-color:var(--${c.k})` },
            h(
              "div",
              { class: "lk", on: toggle(k) },
              h("b", { style: `color:var(--${c.k})` }, c.name),
              span("m", ` ${[c.config.integration, roles].filter(Boolean).join(" · ")}`),
            ),
            ...(ui.open.has(k) ? sheet(d, c) : []),
          );
        })),
    // #404: the new-thread defaults are herdsman's [chat]; drover shows them once v1 can write them.
    head("CHAT DEFAULTS"),
    h(
      "p",
      { class: "m" },
      "a new thread starts with its fleet's conductor (above); setting [chat] defaults here waits for herdsman's v1 write",
    ),
  ];
  // #286: the hosts lanes may run on, each [off]/[on]; #164 #186 #361: fleet disk, orphan folders, leftovers; #440 notifiers.
  const hosts = (d: HostTab): Kid[] => {
    const k = d.disk,
      l = d.leftovers,
      n = d.orphans;
    return some([
      head("HOSTS FOR LANES"),
      ...d.hosts.map((x) =>
        h(
          "div",
          { class: "rw" },
          h("b", {}, x.name),
          x.main && span("tag m", "main"),
          " ",
          span(x.tone, x.words),
          span("m", ` · ${s(x.lanes, "lane")} `),
          d.rw &&
            x.to &&
            sure(
              `host:${x.name}`,
              x.to,
              `turn ${x.name} ${x.to}?${x.to === "off" ? ` no new lanes; ${x.lanes} running lanes finish` : ""}`,
              op("host", { fleet: "", mtime: d.mtime, host: x.name, to: x.to }),
            ),
        ),
      ),
      head("FLEET DISK"),
      k
        ? h(
            "div",
            { class: "rw" },
            "worktrees ",
            gauge(k.bar),
            " ",
            h("b", { class: k.bar.t }, `${k.gb} GB`),
            span("m", ` of ${k.budget} GB budget`),
            k.bar.pct && span(k.bar.t, ` (${k.bar.pct}%)`),
            k.ago != null && span("m", ` · walked ${k.ago} ago`),
          )
        : h("p", { class: "m" }, "not walked yet"),
      n > 0 &&
        h(
          "div",
          { class: "rw" },
          span("a", s(n, "orphan folder")),
          " from no project ",
          d.rw &&
            sure(
              "orphans",
              "remove orphans",
              `Remove ${s(n, "orphan folder")} under the worktree root?`,
              op("orphans", { fleet: "", mtime: d.mtime }),
            ),
        ),
      l &&
        h(
          "div",
          { class: "rw" },
          span("a", s(l.n, "process", "processes")),
          ` left in closed lanes · ${l.mb} MB `,
          d.rw &&
            sure(
              "reap",
              "reap",
              `TERM, then KILL, ${l.n} leftover process(es)?`,
              op("reap", { fleet: "", mtime: d.mtime }),
            ),
        ),
      n === 0 && !l && h("p", { class: "m" }, "no orphan folders, no leftover processes"),
      head("NOTIFIERS", "global · edit fleet.toml"),
      ...(d.notify.length
        ? d.notify.map((x) => h("div", { class: "rw" }, h("b", {}, x.kind), span("m", ` · ${x.on}`)))
        : [h("p", { class: "m" }, "none: [[notify]] in fleet.toml")]),
    ]);
  };
  // #170 #206 #266 #351: chips [all] [important], rows newest first under time groups, a fold one row (a tap lists it).
  const activity = (t: State): Kid[] => {
    const rows = fold(ev, ui.imp),
      color = new Map(t.fleets.map((f) => [f.name, f.color])),
      out: Kid[] = [head("ACTIVITY", s(rows.length, ui.imp ? "important row" : "row"))];
    const chip = (label: string, imp: boolean) =>
      h("button", { "aria-pressed": String(ui.imp === imp), on: () => ((ui.imp = imp), redraw()) }, label);
    out.push(h("p", { class: "btns" }, chip("all", false), chip("important", true)));
    let at = "";
    for (const evs of rows.slice(0, ui.shown)) {
      const e = evs[0],
        g = when(e.ts, t.now, t.tz),
        k = `ev:${e.seq}`;
      if (g !== at) out.push(h("h3", {}, (at = g)));
      const words =
        e.type in NOISE && evs.length > 1
          ? `${e.type} ×${evs.length} · ${NOISE[e.type]}`
          : evs.length > 1
            ? e.text.replace(" · ", ` ×${evs.length} · `)
            : e.text;
      out.push(
        h(
          "div",
          { class: `er${e.imp ? " imp" : ""}`, on: toggle(k) },
          span(`kg ${e.tone}`, e.glyph),
          " ",
          h("b", { style: `color:var(--${color.get(e.fleet) ?? "fg"})` }, e.fleet),
          e.issue != null && ` #${e.issue}`,
          ` ${words} `,
          span("m", dur(Math.max(0, t.now - e.ts))),
          ...(ui.open.has(k) ? evs.map((x) => h("p", { class: "m" }, `${x.type} · ${x.plain}`)) : []),
        ),
      );
    }
    if (rows.length > ui.shown || (first() > 1 && first() !== Infinity))
      out.push(h("button", { class: "lk", on: older }, "older"));
    return out;
  };
  const view = (): Kid[] => {
    if (busy) return strip(slow);
    return some([
      ...strip(slow),
      ...err.map((e) => h("p", { class: "r" }, e)),
      ui.msg[1] && h("p", { class: ui.msg[0] }, ui.msg[1]),
      ...(q ? fleets(q) : []),
      ...(hs ? hosts(hs) : []),
      ...(st ? activity(st) : []),
    ]);
  };
  return { load };
}

export const CSS = `
body{font:15px system-ui,sans-serif;color:var(--fg);background:var(--bg);margin:8px}a{color:var(--link)}
button,select{font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--edge);border-radius:6px;padding:2px 8px;margin:2px}
button[aria-pressed=true]{background:var(--edge)}h2{font-size:.9em;color:var(--mute);margin:16px 0 4px}h3{font-size:.85em;color:var(--mute);margin:8px 0 2px}
.fc{background:var(--card);border:1px solid var(--edge);border-left:4px solid;border-radius:8px;padding:8px;margin:6px 0}.lk,.er{cursor:pointer}
.cg{border-top:1px solid var(--edge);padding:4px 0}p{margin:3px 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 10px;margin:4px 0}
dt{color:var(--mute)}dd{margin:0}.rw,.er{padding:3px 0;border-top:1px solid var(--edge)}.er p{margin-left:20px}.kg{display:inline-block;width:1.2em}
.pd{padding-left:20px}.bar{font-family:monospace}.tag{font-size:.85em;margin-left:4px}.sure{color:var(--a)}
.g{color:var(--g)}.a{color:var(--a)}.r{color:var(--r)}.m{color:var(--mute)}
`;
