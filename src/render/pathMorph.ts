// Declarative SVG path morphing for Tier-1 motion HTML.
//
//   <path data-kino-morph-from="M0,0 L10,0 L10,10Z"
//         data-kino-morph-to="M0,0 C5,2 8,6 10,10Z"
//         data-kino-morph-t="var(--morph)" />
//
// The engine rewrites that element's `d` every frame from the driver's value. A Tier-1 author has no
// JS and CSS cannot interpolate a path (`d` is animatable only via SMIL or CSS transitions, both
// banned here for determinism), so the honest options were an opacity crossfade between two static
// shapes — which reads as two shapes, never as one becoming the other — or nothing. A 37-beat review
// produced exactly that crossfade: two CSS `border-radius` blobs dissolving where a ribbon was meant
// to become a numeral. It scored 4/10, the worst in the reel.
//
// Everything here is a pure function of (markup, this frame's variables): parse, compare structure,
// lerp, format. No wall clock, no state between frames, so a seek to an arbitrary frame N produces
// the same `d` whatever order the frames were rendered in.
//
// Deliberately NOT flubber: a general path matcher (resample, rotate, split subpaths) is a dependency
// and a heuristic. Requiring matching command structure is a constraint the author can see and fix,
// and the failure is loud — see structureMismatch, which names the differing command rather than
// producing the plausible-looking garbage a silent number-lerp gives (lensShape.lerpPathD's
// `t < 0.5 ? d0 : d1` fallback is the older, quieter version of this problem).

export const MORPH_FROM = "data-kino-morph-from";
export const MORPH_TO = "data-kino-morph-to";
export const MORPH_T = "data-kino-morph-t";

/** Driver used when `data-kino-morph-t` is omitted — the beat's linear 0→1. */
export const MORPH_T_DEFAULT = "var(--progress)";

/** Cheap gate so a page with no morphs pays nothing (no parse, no rewrite). */
export function hasPathMorph(html: string): boolean {
  return html.includes(MORPH_FROM);
}

export interface PathCmd {
  /** The command letter as written — case matters: `L` and `l` are different geometry. */
  cmd: string;
  args: number[];
}

/** Argument count per command, keyed by the lowercased letter. */
const ARGC: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Arc argument slots that are FLAGS, not numbers: large-arc-flag and sweep-flag. */
const ARC_FLAGS = new Set([3, 4]);

const isDigit = (ch: string): boolean => ch >= "0" && ch <= "9";
const isSep = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "," || ch === "\f";

/**
 * Parse an SVG `d` into a flat command list, expanding the implicit forms the grammar allows:
 * repeated argument groups (`L1,2 3,4` → two `L`s) and the implicit `L`/`l` that follows a moveto.
 * Expanding them is what makes structure comparison meaningful — `M0,0L1,1L2,2` and `M0,0 1,1 2,2`
 * are the same path and must compare equal.
 *
 * Throws with the offset on malformed input. An unparseable path is an authoring bug, and the
 * alternative (return null, fall back to the static `d`) is the silent failure this module exists
 * to remove.
 */
export function parsePathD(d: string): PathCmd[] {
  const cmds: PathCmd[] = [];
  const n = d.length;
  let i = 0;
  let cur = "";

  const skipSep = (): void => {
    while (i < n && isSep(d[i])) i++;
  };

  const readNumber = (flag: boolean): number => {
    skipSep();
    const start = i;
    if (flag) {
      // Arc flags are a single 0/1 digit and may be packed against the next number ("a1 1 0 011 1"),
      // so they cannot go through the general number scanner.
      if (d[i] === "0" || d[i] === "1") {
        i++;
        return Number(d[start]);
      }
      throw new Error(`expected an arc flag (0 or 1) at offset ${i} of "${d}"`);
    }
    if (d[i] === "+" || d[i] === "-") i++;
    while (i < n && isDigit(d[i])) i++;
    if (d[i] === ".") {
      i++;
      while (i < n && isDigit(d[i])) i++;
    }
    if (d[i] === "e" || d[i] === "E") {
      const mark = i;
      i++;
      if (d[i] === "+" || d[i] === "-") i++;
      if (i < n && isDigit(d[i])) {
        while (i < n && isDigit(d[i])) i++;
      } else {
        i = mark; // a trailing "e" that isn't an exponent — leave it for the command scanner to reject
      }
    }
    const raw = d.slice(start, i);
    const v = Number(raw);
    if (raw === "" || raw === "-" || raw === "+" || raw === "." || !Number.isFinite(v)) {
      throw new Error(`expected a number at offset ${start} of "${d}"`);
    }
    return v;
  };

  for (;;) {
    skipSep();
    if (i >= n) break;
    const ch = d[i];
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) {
      cur = ch;
      i++;
    } else if (!cur) {
      throw new Error(`path must start with a command letter, found "${ch}" in "${d}"`);
    }
    const key = cur.toLowerCase();
    const argc = ARGC[key];
    if (argc === undefined) throw new Error(`unknown path command "${cur}" in "${d}"`);
    const args: number[] = [];
    for (let a = 0; a < argc; a++) args.push(readNumber(key === "a" && ARC_FLAGS.has(a)));
    cmds.push({ cmd: cur, args });
    // After an explicit moveto, further argument groups are implicit line-tos. After a closepath
    // there is nothing to repeat, so clear `cur` and let a stray number fail loudly.
    if (cur === "M") cur = "L";
    else if (cur === "m") cur = "l";
    else if (key === "z") cur = "";
  }
  if (cmds.length === 0) throw new Error(`empty path data ("${d}")`);
  return cmds;
}

/** Short, stable serialisation of one coordinate. 4dp is well below a rendered pixel at any scale
 *  kino composes at, and rounding keeps the output byte-identical across platforms' float printing. */
function fmt(v: number): string {
  const r = Math.round(v * 1e4) / 1e4;
  return Object.is(r, -0) ? "0" : String(r);
}

export function formatPathD(cmds: PathCmd[]): string {
  return cmds.map((c) => (c.args.length ? c.cmd + c.args.map(fmt).join(" ") : c.cmd)).join(" ");
}

/**
 * Why the two paths cannot be interpolated, or null when they can. The message names the exact
 * command so the author can fix the shape rather than guess — a mismatch here used to mean either a
 * hard cut at t=0.5 or a coordinate-count-aligned lerp between unrelated commands.
 */
export function structureMismatch(from: PathCmd[], to: PathCmd[]): string | null {
  if (from.length !== to.length) {
    return `command count differs — "from" has ${from.length}, "to" has ${to.length}. Interpolation needs the same command sequence in both paths (same letters, same order); add or remove segments so they match.`;
  }
  for (let k = 0; k < from.length; k++) {
    const a = from[k];
    const b = to[k];
    if (a.cmd !== b.cmd) {
      return `command ${k + 1} differs — "from" has "${a.cmd}", "to" has "${b.cmd}". Interpolation needs identical command letters (and the same case: "L" and "l" are absolute vs relative).`;
    }
    if (a.args.length !== b.args.length) {
      return `command ${k + 1} ("${a.cmd}") has ${a.args.length} coordinates in "from" and ${b.args.length} in "to".`;
    }
    if (a.cmd.toLowerCase() === "a") {
      for (const f of ARC_FLAGS) {
        if (a.args[f] !== b.args[f]) {
          // A flag is a boolean; a lerped 0.5 is not a half-turn, it is whatever the parser rounds it
          // to. Refusing is the only honest answer.
          return `command ${k + 1} ("${a.cmd}") differs in arc flag ${f === 3 ? "large-arc" : "sweep"} (${a.args[f]} vs ${b.args[f]}), which is a boolean and cannot be interpolated. Split the arc, or keep both flags equal.`;
        }
      }
    }
  }
  return null;
}

/**
 * Interpolate `d` between two structurally-matching paths. `t` is clamped to 0..1 — a driver that
 * overshoots (--kino-overshoot, --kino-spring) must not fling control points past the target shape.
 * Throws the structureMismatch message when the paths don't line up.
 */
export function morphPathD(from: string, to: string, t: number): string {
  const a = parsePathD(from);
  const b = parsePathD(to);
  const bad = structureMismatch(a, b);
  if (bad) throw new Error(bad);
  const k = Math.min(1, Math.max(0, t));
  return formatPathD(
    a.map((cmd, ci) => ({
      cmd: cmd.cmd,
      args: cmd.args.map((v, ai) =>
        cmd.cmd.toLowerCase() === "a" && ARC_FLAGS.has(ai) ? v : v + (b[ci].args[ai] - v) * k,
      ),
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Driver expression
// ---------------------------------------------------------------------------------------------

interface Cursor {
  s: string;
  i: number;
}

/** How to treat a var() the frame doesn't define: fail (render) or assume 0 (static lint). */
export type MissingVar = "throw" | "zero";

const ws = (c: Cursor): void => {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
};

const eat = (c: Cursor, token: string): boolean => {
  ws(c);
  if (c.s.slice(c.i, c.i + token.length).toLowerCase() === token) {
    c.i += token.length;
    return true;
  }
  return false;
};

function primary(c: Cursor, vars: Record<string, string>, missing: MissingVar): number {
  ws(c);
  if (eat(c, "var(")) {
    ws(c);
    const start = c.i;
    while (c.i < c.s.length && /[-\w]/.test(c.s[c.i])) c.i++;
    const name = c.s.slice(start, c.i);
    if (!name.startsWith("--")) throw new Error(`var() needs a custom property name, found "${name}"`);
    let fallback: number | null = null;
    ws(c);
    if (c.s[c.i] === ",") {
      c.i++;
      fallback = expr(c, vars, missing);
    }
    if (!eat(c, ")")) throw new Error(`unclosed var(${name}`);
    const raw = vars[name];
    const v = raw === undefined ? NaN : parseFloat(raw);
    if (Number.isFinite(v)) return v;
    if (fallback !== null) return fallback;
    if (missing === "zero") return 0;
    throw new Error(
      `${name} is not a kino variable on this frame — declare it in the beat's "params" (and keyframe it), or drive the morph from a frame variable such as --progress / --kino-inout`,
    );
  }
  for (const fn of ["calc(", "clamp(", "min(", "max("] as const) {
    if (eat(c, fn)) {
      const args: number[] = [expr(c, vars, missing)];
      ws(c);
      while (c.s[c.i] === ",") {
        c.i++;
        args.push(expr(c, vars, missing));
        ws(c);
      }
      if (!eat(c, ")")) throw new Error(`unclosed ${fn.slice(0, -1)}()`);
      if (fn === "calc(") {
        if (args.length !== 1) throw new Error("calc() takes one expression");
        return args[0];
      }
      if (fn === "clamp(") {
        if (args.length !== 3) throw new Error("clamp() takes exactly three arguments");
        return Math.min(Math.max(args[1], args[0]), args[2]);
      }
      return fn === "min(" ? Math.min(...args) : Math.max(...args);
    }
  }
  if (eat(c, "(")) {
    const v = expr(c, vars, missing);
    if (!eat(c, ")")) throw new Error("unclosed (");
    return v;
  }
  const m = /^[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/.exec(c.s.slice(c.i));
  if (!m) throw new Error(`expected a number, var() or calc() at "${c.s.slice(c.i, c.i + 24)}"`);
  c.i += m[0].length;
  // A trailing unit would make the value meaningless as a 0..1 driver; reject rather than ignore it.
  const unit = /^[a-z%]+/i.exec(c.s.slice(c.i));
  if (unit) throw new Error(`the morph driver is unitless (0 → 1) — drop the "${unit[0]}"`);
  return Number(m[0]);
}

function unary(c: Cursor, vars: Record<string, string>, missing: MissingVar): number {
  ws(c);
  if (c.s[c.i] === "-") {
    c.i++;
    return -unary(c, vars, missing);
  }
  if (c.s[c.i] === "+") {
    c.i++;
    return unary(c, vars, missing);
  }
  return primary(c, vars, missing);
}

function term(c: Cursor, vars: Record<string, string>, missing: MissingVar): number {
  let v = unary(c, vars, missing);
  for (;;) {
    ws(c);
    const op = c.s[c.i];
    if (op !== "*" && op !== "/") return v;
    c.i++;
    const rhs = unary(c, vars, missing);
    v = op === "*" ? v * rhs : rhs === 0 ? NaN : v / rhs;
  }
}

function expr(c: Cursor, vars: Record<string, string>, missing: MissingVar): number {
  let v = term(c, vars, missing);
  for (;;) {
    ws(c);
    const op = c.s[c.i];
    if (op !== "+" && op !== "-") return v;
    c.i++;
    const rhs = term(c, vars, missing);
    v = op === "+" ? v + rhs : v - rhs;
  }
}

/**
 * Evaluate a morph driver: a number, a `var(--x[, fallback])`, or arithmetic over those wrapped in
 * calc/clamp/min/max. Deliberately a small numeric language rather than "real CSS" — the engine has
 * no cascade to resolve here, only this frame's variable set. It is enough for the two things authors
 * need: point the morph at a keyframed param, and stagger a row of morphs off one driver
 * (`calc((var(--progress) - .1) * 3)`).
 */
export function evalMorphDriver(
  raw: string,
  vars: Record<string, string>,
  missing: MissingVar = "throw",
): number {
  const c: Cursor = { s: raw.trim(), i: 0 };
  if (c.s === "") throw new Error("empty morph driver");
  const v = expr(c, vars, missing);
  ws(c);
  if (c.i < c.s.length) throw new Error(`unexpected "${c.s.slice(c.i)}" in morph driver "${raw}"`);
  if (!Number.isFinite(v)) throw new Error(`morph driver "${raw}" does not evaluate to a finite number`);
  return v;
}

// ---------------------------------------------------------------------------------------------
// Markup rewrite
// ---------------------------------------------------------------------------------------------

// Attribute values in motion markup are always quoted (DOMPurify normalises them), so excluding
// quotes from the unquoted run is enough to keep the scan from walking past the tag's own `>`.
const TAG_RE = /<([a-zA-Z][\w:.-]*)((?:'[^']*'|"[^"]*"|[^>'"])*)(\/?)>/g;
/** The `d` presentation attribute. The leading boundary is what keeps this off `data-…`. */
const D_ATTR_RE = /(^|\s)d\s*=\s*(?:"[^"]*"|'[^']*')/gi;

function attrValue(attrs: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i");
  const m = re.exec(attrs);
  if (!m) return null;
  return m[2] ?? m[3] ?? "";
}

/** Path data is long; quote a recognisable head in an error rather than the whole thing. */
const clip = (s: string, max = 64): string => (s.length <= max ? s : `${s.slice(0, max)}…`);

export interface PathMorphResult {
  html: string;
  /** Authoring faults, each ready to hand to reportFatal. Empty on success. */
  errors: string[];
}

/**
 * Resolve every `data-kino-morph-*` element in `html` against this frame's variables, writing the
 * interpolated shape into `d`. A failing element keeps its authored `d` and contributes an error —
 * the render fails on it, so nothing ships from a half-resolved morph.
 */
export function applyPathMorphs(html: string, vars: Record<string, string>): PathMorphResult {
  if (!hasPathMorph(html)) return { html, errors: [] };
  const errors: string[] = [];
  const out = html.replace(TAG_RE, (whole, tag: string, attrs: string, slash: string) => {
    const from = attrValue(attrs, MORPH_FROM);
    if (from === null) return whole;
    const to = attrValue(attrs, MORPH_TO);
    if (to === null) {
      errors.push(`<${tag} ${MORPH_FROM}="${clip(from)}"> has no ${MORPH_TO} — a morph needs both endpoints`);
      return whole;
    }
    const driver = attrValue(attrs, MORPH_T) ?? MORPH_T_DEFAULT;
    let d: string;
    try {
      d = morphPathD(from, to, evalMorphDriver(driver, vars));
    } catch (err) {
      errors.push(`<${tag} ${MORPH_T}="${driver}">: ${(err as Error).message}`);
      return whole;
    }
    return `<${tag}${attrs.replace(D_ATTR_RE, "$1")} d="${d}"${slash}>`;
  });
  return { html: out, errors };
}

/**
 * Static check for a motion source, so a structural mismatch fails at authoring time (validate /
 * still / storyboard) instead of mid-render. Only the parts that don't need a frame are checked:
 * both paths parse, their structures line up, and the driver is syntactically a number expression.
 */
export function lintPathMorphs(html: string): string[] {
  if (!hasPathMorph(html)) return [];
  const problems: string[] = [];
  for (const m of html.matchAll(TAG_RE)) {
    const attrs = m[2];
    const from = attrValue(attrs, MORPH_FROM);
    if (from === null) continue;
    const to = attrValue(attrs, MORPH_TO);
    if (to === null) {
      problems.push(`${MORPH_FROM}="${clip(from)}" has no ${MORPH_TO} — a morph needs both endpoints`);
      continue;
    }
    try {
      // Any t exercises the same parse + structure check; 0.5 also proves the lerp itself runs.
      morphPathD(from, to, 0.5);
    } catch (err) {
      problems.push(`${MORPH_FROM}/${MORPH_TO} cannot be interpolated: ${(err as Error).message}`);
      continue;
    }
    const driver = attrValue(attrs, MORPH_T);
    if (driver !== null) {
      try {
        evalMorphDriver(driver, {}, "zero");
      } catch (err) {
        problems.push(`${MORPH_T}="${driver}": ${(err as Error).message}`);
      }
    }
  }
  return problems;
}
