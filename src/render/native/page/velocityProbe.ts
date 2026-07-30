// The measuring half of `data-kino-vel` (see src/render/motionVelocity.ts for the contract and the
// seek-independence argument).
//
// Two layout passes over ONE mounted host: drive it with the earlier sample's variables, read the
// opted-in boxes, drive it with the later sample's, read again, diff. Both samples are re-derived
// here rather than remembered, which is the whole point — frame N's answer must not depend on whether
// any neighbouring frame was ever rendered in this process.
//
// The pair STRADDLES the rendered frame (N-1 and N+1) instead of trailing it (N-1 and N). Same two
// passes, but it removes the one-frame velocity hole an easing zero puts in the middle of a move —
// see velocityVarDecls for the failure that motivated it.
//
// The host is mountMotionRasterProbe, i.e. the tree that matches buildTemplate → foreignObject, NOT a
// convenience wrapper: measuring a differently-shaped tree is a failure mode this codebase has
// already paid for twice (see the probe's own docstring, and the header of src/render/measure.ts
// where a [data-measure] DOM walk was removed because staged markup sits off-screen).
import type { Theme } from "../../props.js";
import { mountMotionRasterProbe } from "./motionRaster.js";
import { VEL_ATTR, velocityVarDecls, writeVelocityVars, type VelBox } from "../../motionVelocity.js";
import * as prof from "./compositor/profile.js";

/** Centres of the opted-in elements, indexed by the number annotateVelocityTargets stamped on them.
 *  Host-relative so the probe's page position cancels out of the diff. */
function readCentres(texRoot: HTMLElement, count: number): (VelBox | undefined)[] {
  const host = texRoot.getBoundingClientRect();
  const out: (VelBox | undefined)[] = new Array(count).fill(undefined);
  for (const el of Array.from(texRoot.querySelectorAll<HTMLElement>(`[${VEL_ATTR}]`))) {
    const i = Number(el.getAttribute(VEL_ATTR));
    if (!Number.isInteger(i) || i < 0 || i >= count) continue;
    // getBoundingClientRect is post-transform, which is exactly the travel an author animates; the
    // centre stays right for a rotated element, where the rect itself is the axis-aligned bound.
    const r = el.getBoundingClientRect();
    out[i] = { cx: r.left - host.left + r.width / 2, cy: r.top - host.top + r.height / 2 };
  }
  return out;
}

export interface VelocityMeasureOpts {
  /** The frame being rendered — the markup the measured properties are written into. */
  html: string;
  /** Earlier sample: markup + variables for the frame BEFORE the one being rendered. Annotated the
   *  same way (identical for a Tier-1 page; a Tier-2 proc re-runs, so its markup may differ — the
   *  indices are what pairs the elements up). */
  aHtml: string;
  aVars: Record<string, string>;
  /** Later sample: markup + variables for the frame AFTER the one being rendered. */
  bHtml: string;
  bVars: Record<string, string>;
  /** Frames between the two samples — 2 for the straddling pair, 1 at a beat edge where only one
   *  side exists. See velocityVarDecls for why the pair straddles rather than trails. */
  span: number;
  theme: Theme;
  width: number;
  height: number;
  count: number;
}

/** `html` with each opted-in element's velocity properties written into its style attribute. */
export function measureVelocity(opts: VelocityMeasureOpts): string {
  const probe = mountMotionRasterProbe(opts.aHtml, opts.aVars, opts.theme, opts.width, opts.height);
  try {
    const a = readCentres(probe.texRoot, opts.count);
    // Re-parse the markup rather than only swapping the <style> text: a scrubbed @keyframes carries
    // paused animation state, and a fresh subtree is the one way to be certain it recomputes against
    // the new --progress instead of holding the earlier sample's position.
    probe.setFrame(opts.bHtml, opts.bVars);
    const b = readCentres(probe.texRoot, opts.count);
    const decls = a.map((box, i) => velocityVarDecls(box, b[i], opts.span));
    prof.addSample("motion:velTargets", opts.count);
    return writeVelocityVars(opts.html, decls);
  } finally {
    probe.unmount();
  }
}
