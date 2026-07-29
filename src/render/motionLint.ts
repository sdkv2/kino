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

/** Every dead-visual check, for a motion source of any tier. Empty = clean. */
export function lintDeadVisuals(src: string): string[] {
  return lintPinnedClamps(src);
}
