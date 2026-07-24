// Fatal render faults raised from inside the page, for the node driver to pick up.
//
// A GLSL program that won't compile is an authoring bug, not a flaky asset: the beat keeps
// rendering, just with no shader, so the failure ships as a flat wash in an otherwise fine mp4.
// A console.error is invisible from the CLI (the page's console is only forwarded under
// KINO_NATIVE_DEBUG), so the render "succeeds" and you find out by watching the output.
//
// Record the first fault on window.__kinoFatal; engine.ts reads it after every seek and fails
// the render with this text. First one wins — later frames report the same broken program, and
// the first report is the one with the useful context.

declare global {
  interface Window {
    __kinoFatal?: string;
  }
}

/** Prefix each line with its 1-based number, so a driver log's "ERROR: 0:42" is findable.
 *  GLSL logs cite lines in the *assembled* source, which the author never sees — without this
 *  the line number points into a file that doesn't exist on disk. */
function numberLines(source: string): string {
  const lines = source.split("\n");
  // Enough to place the error; a full raymarch frag is thousands of lines of mostly preamble.
  const MAX = 400;
  const shown = lines.slice(0, MAX).map((l, i) => `${String(i + 1).padStart(4)} | ${l}`);
  if (lines.length > MAX) shown.push(`     | … ${lines.length - MAX} more line(s)`);
  return shown.join("\n");
}

/** Report an unrecoverable render fault. `what` names the surface ("RegionShader program"),
 *  `log` is the driver's info log, `source` the exact string handed to the driver. */
export function reportFatal(what: string, log: string | null, source?: string): void {
  const detail = (log ?? "").trim() || "(driver returned no info log)";
  const body = source ? `${detail}\n\n--- assembled source ---\n${numberLines(source)}` : detail;
  window.__kinoFatal ??= `${what}: ${body}`;
  // Still log it — under KINO_NATIVE_DEBUG this shows up at the point of failure.
  console.error(window.__kinoFatal);
}
