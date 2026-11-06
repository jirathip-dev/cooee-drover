// A tab as data: `h` builds a tree a test can walk and tap (pure), `mount` draws it in the frame.
export type Attrs = { [k: string]: string | ((v: string) => unknown) | undefined };
export type El = { t: string; a: Attrs; k: Kid[] };
export type Kid = El | string;

/** `<t a>k</t>`; an `on` attr is the tap, `oninput` an input's or select's new value; false and null kids drop. */
export const h = (t: string, a: Attrs = {}, ...k: (Kid | false | null | undefined)[]): El => ({
  t,
  a,
  k: k.filter((x): x is Kid => x != null && x !== false),
});

function node(n: Kid): Node {
  if (typeof n === "string") return document.createTextNode(n);
  const e = document.createElement(n.t);
  for (const [k, v] of Object.entries(n.a)) {
    if (typeof v === "function") {
      e.addEventListener(k === "on" ? "click" : "input", () => v((e as HTMLInputElement).value));
    } else if (v != null) e.setAttribute(k, v);
  }
  if (n.t === "input") (e as HTMLInputElement).value = n.a.value as string ?? "";
  e.append(...n.k.map(node));
  return e;
}

/** Draws `kids` as the frame's body with `css`; the focused field (by `id`) keeps its focus and caret. */
export function mount(kids: Kid[], css: string): void {
  const f = document.activeElement as HTMLInputElement | null, id = f?.id, at = f?.selectionStart;
  document.head.replaceChildren(Object.assign(document.createElement("style"), { textContent: css }));
  document.body.replaceChildren(...kids.map(node));
  const g = id ? (document.getElementById(id) as HTMLInputElement | null) : null;
  g?.focus();
  if (g && at != null) g.setSelectionRange(at, at);
}
