// Dead-visual lint: catch declarations that are provably pinned to a constant, so an effect the
// author believes is animating can never appear on screen.
//
// The motivating defect, from a 37-beat authored-graphic review: a beat's signature effect was
// eight coloured smear blobs whose rule ended `opacity: clamp(0, calc(…), 0)`. The third argument
// to clamp() is the UPPER bound, so per CSS Values `clamp(MIN, VAL, MAX)` = `max(MIN, min(VAL, MAX))`
// — with MAX <= MIN that is MIN for every input. All eight blobs were invisible in every frame of
// every render. Nothing caught it: the page renders, the determinism lint passes (no wall clock),
// and the under-animation probe clears the beat because the *letters* animate. The authoring agent's
// own report asserted the smears rendered.
//
// A frame-diff probe structurally cannot see this — the beat does animate, just not the part that
// mattered. But the bug is decidable from the source alone, at zero render cost, which makes it a
// lint rather than a QA pass. There is no legitimate reason to write a clamp whose bounds cross:
// the author either meant a real upper bound or meant a constant.
//
// Pure — no DOM, no fs. Unit-tested.
//
// motionCss.ts is import-free string constants, so the scrub-class list and the injected filter ids
// are derived from the very markup the renderer injects rather than restated here.
import { motionScrubCss, KINO_FILTERS } from "./native/page/motionCss.js";

/** A numeric CSS literal: value plus its unit ("" when unitless). Non-literals (var(), calc(), a
 *  percentage of something unknown) return null — an un-evaluatable bound is never flagged. */
function numericLiteral(tok: string): { value: number; unit: string } | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i.exec(tok.trim());
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? { value, unit: (m[2] ?? "").toLowerCase() } : null;
}

/** Split a function's argument list on top-level commas, ignoring commas nested in parens (calc(),
 *  var(--x, fallback), nested clamp(), …). `body` is the text between the outer parens. */
function splitTopLevelArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      args.push(body.slice(start, i));
      start = i + 1;
    }
  }
  args.push(body.slice(start));
  return args;
}

/** Every `clamp(...)` call in `src`, as the text between its outer parens. Scans rather than regexes
 *  so nested parens inside the arguments are handled. */
function clampBodies(src: string): string[] {
  const out: string[] = [];
  const re = /\bclamp\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) break; // unbalanced — leave it to the CSS parser
    out.push(src.slice(open + 1, end));
    re.lastIndex = end;
  }
  return out;
}

/**
 * Violations for `clamp()` calls whose bounds cross or coincide, making the result a constant.
 *
 * Only fires when BOTH bounds are numeric literals in the same unit — a bound built from `var()` or
 * `calc()` can't be judged statically and is left alone.
 */
export function lintPinnedClamps(src: string): string[] {
  const out: string[] = [];
  for (const body of clampBodies(src)) {
    const args = splitTopLevelArgs(body);
    if (args.length !== 3) continue; // not the 3-arg form; nothing to prove
    const lo = numericLiteral(args[0]!);
    const hi = numericLiteral(args[2]!);
    if (!lo || !hi || lo.unit !== hi.unit) continue;
    if (hi.value <= lo.value) {
      const u = lo.unit;
      out.push(
        `clamp(${lo.value}${u}, …, ${hi.value}${u}) is pinned to ${lo.value}${u} — clamp's third ` +
          `argument is the UPPER bound, so a max at or below the min ignores the middle value ` +
          `entirely and this declaration can never animate. Did you mean ` +
          `clamp(${lo.value}${u}, …, 1${u === "" ? "" : u})?`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Scrub-class placement.
//
// `.kino-anim` (and the helper classes) is what makes an @keyframes animation frame-driven: the
// injected rule pins animation-duration to 1s and seeks it with a negative animation-delay. Put the
// class on a WRAPPER while the animation sits on its children and nothing errors — the children
// keep CSS's default `animation-duration: 0s`, so every one of them paints its END state from frame
// 0. The beat does not look broken; it looks *already finished*, which is why it survives a
// midpoint still, a storyboard, and the under-animation probe (the wrapper's own entrance moves).
//
// Decidable from source for the common case: if a CLASS selector declares an animation and every
// element carrying that class lacks a scrub class, the animation provably cannot be scrubbed.

/** The classes kino scrubs, read out of the injected rule itself so this can't drift from the CSS. */
const SCRUB_CLASSES: string[] = (() => {
  const m = /([^{}]*)\{animation-duration:1s\s*!important/.exec(motionScrubCss(":host"));
  return (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/^\./, "")).filter(Boolean);
})();

/** Class tokens on every `class="..."` / `class='...'` attribute in the source. */
function classAttrs(src: string): string[][] {
  const out: string[][] = [];
  const re = /\bclass\s*=\s*(["'])([^"']*)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[2]!.split(/\s+/).filter(Boolean));
  return out;
}

/**
 * Class-token sets that a rule's SUBJECT must carry, for rules that start an animation.
 *
 * Only the subject — the rightmost compound selector — is the animated element. Reading every class
 * in the selector is wrong and was a live false positive: `.line span { animation-name: rise }`
 * animates the spans, not `.line`, and the library page that does exactly this correctly puts
 * `kino-anim` on each span. A subject with no class of its own (`span`, `*`, `:host > div`) is not
 * decidable from text, so it is skipped rather than guessed at.
 */
function animatedSubjects(src: string): string[][] {
  const found: string[][] = [];
  const seen = new Set<string>();
  // Rule bodies only: a selector list followed by { ... }. @keyframes stops declare no
  // `animation-name`, so scanning flat is sufficient here.
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const [, selectorList, body] = m as unknown as [string, string, string];
    // `animation-duration`/`-delay`/… alone don't start an animation; require a name.
    if (!/\banimation(-name)?\s*:/.test(body)) continue;
    if (/\banimation\s*:/.test(body) && !/\banimation-name\s*:/.test(body)) {
      // Shorthand naming nothing (e.g. `animation: none`) starts no animation.
      if (!/\banimation\s*:[^;]*[a-zA-Z_-][\w-]*/.test(body)) continue;
    }
    for (const selector of selectorList.split(",")) {
      // Subject = the last compound, i.e. what follows the final descendant/child/sibling combinator.
      const subject = selector.trim().split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
      const classes = (subject.match(/\.[-_a-zA-Z][\w-]*/g) ?? []).map((c) => c.slice(1));
      if (!classes.length) continue; // type/universal subject — undecidable
      const key = classes.slice().sort().join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(classes);
    }
  }
  return found;
}

/**
 * Violations for animated classes whose elements never carry a scrub class.
 *
 * Deliberately conservative — it stays silent when the class appears in no `class` attribute at all
 * (a Tier-2 proc may build that attribute in a way a text scan can't see), and it only considers
 * plain class selectors. It fires only when the markup positively shows the class on elements and
 * none of them opt into the scrub.
 */
export function lintAnimScrubClass(src: string): string[] {
  const attrs = classAttrs(src);
  const out: string[] = [];
  for (const classes of animatedSubjects(src)) {
    if (classes.some((c) => SCRUB_CLASSES.includes(c))) continue; // helper classes scrub themselves
    const carriers = attrs.filter((tokens) => classes.every((c) => tokens.includes(c)));
    if (!carriers.length) continue; // never seen in markup — undecidable, not wrong
    if (carriers.some((tokens) => tokens.some((t) => SCRUB_CLASSES.includes(t)))) continue;
    const sel = classes.map((c) => `.${c}`).join("");
    out.push(
      `${sel} declares an animation but no element matching it carries a scrub class ` +
        `(${SCRUB_CLASSES.map((c) => `"${c}"`).join(", ")}). kino only scrubs the element the class ` +
        `is ON — on a parent it does nothing, and the child keeps CSS's default ` +
        `animation-duration: 0s, painting its END state from frame 0 (the beat looks already ` +
        `finished, not broken). Move the class onto the ${sel} element itself.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Unresolved fragment references.
//
// Per SVG, an element whose `filter` points at an id that does not exist renders NOTHING — not
// unfiltered, nothing. So one typo'd (or never-emitted) filter id silently deletes a whole layer,
// with no error anywhere. `mask` and `clip-path` fail the same way.

/** Ids kino injects into every motion page, parsed from the injected markup so it can't drift. */
const KINO_IDS: string[] = [
  ...(KINO_FILTERS.match(/\bid="([^"]+)"/g) ?? []).map((s) => s.slice(4, -1)),
  // Host chrome from the page shell, referenceable but defined outside the motion source.
  "kino-film-grain",
  "kino-stage",
  "kino-staging",
];

/** Blank out `data:` URI payloads — ids inside one resolve within that document, not this one. */
function stripDataUris(src: string): string {
  return src.replace(/url\(\s*(["']?)data:[^)]*\1\s*\)/gi, "url(data:)");
}

/** Violations for `url(#id)` references whose id is defined neither locally nor by kino. */
export function lintUnresolvedFilterRefs(src: string): string[] {
  const scanned = stripDataUris(src);
  const defined = new Set<string>((src.match(/\bid="([^"]+)"/g) ?? []).map((s) => s.slice(4, -1)));
  for (const s of src.match(/\bid='([^']+)'/g) ?? []) defined.add(s.slice(4, -1));
  const missing = new Set<string>();
  const re = /url\(\s*['"]?#([-_a-zA-Z][\w-]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned))) {
    const id = m[1]!;
    if (defined.has(id) || KINO_IDS.includes(id)) continue;
    missing.add(id);
  }
  return [...missing].map(
    (id) =>
      `url(#${id}) references an id that is not defined in this source (and is not one kino ` +
      `injects). An element whose filter/mask/clip-path points at a missing id renders NOTHING — ` +
      `the layer disappears with no error. Define #${id}, or fix the reference.`,
  );
}

/** Every dead-visual check, for a motion source of any tier. Empty = clean. */
export function lintDeadVisuals(src: string): string[] {
  return lintPinnedClamps(src);
}
