// The measuring half of `data-kino-vel` (see src/render/motionVelocity.ts for the contract and the
// seek-independence argument).
//
// Two layout passes over ONE mounted host: drive it with the reference frame's variables, read the
// opted-in boxes, drive it with this frame's variables, read again, diff. The reference frame is
// re-derived here rather than remembered, which is the whole point — frame N's answer must not depend
// on whether frame N-1 was ever rendered in this process.
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
  /** This frame's markup, already annotated with indices. */
  html: string;
  /** The reference frame's markup, annotated the same way (identical for a Tier-1 page; a Tier-2
   *  proc re-runs, so its markup may differ — the indices are what pairs the elements up). */
  refHtml: string;
  vars: Record<string, string>;
  refVars: Record<string, string>;
  theme: Theme;
  width: number;
  height: number;
  /** True on the beat's opening frame, where the reference is the frame AFTER this one. */
  forward: boolean;
  count: number;
}

/** `html` with each opted-in element's velocity properties written into its style attribute. */
export function measureVelocity(opts: VelocityMeasureOpts): string {
  const probe = mountMotionRasterProbe(opts.refHtml, opts.refVars, opts.theme, opts.width, opts.height);
  try {
    const ref = readCentres(probe.texRoot, opts.count);
    // Re-parse the markup rather than only swapping the <style> text: a scrubbed @keyframes carries
    // paused animation state, and a fresh subtree is the one way to be certain it recomputes against
    // the new --progress instead of holding the reference frame's position.
    probe.setFrame(opts.html, opts.vars);
    const cur = readCentres(probe.texRoot, opts.count);
    const decls = cur.map((box, i) => velocityVarDecls(box, ref[i], opts.forward));
    prof.addSample("motion:velTargets", opts.count);
    return writeVelocityVars(opts.html, decls);
  } finally {
    probe.unmount();
  }
}
