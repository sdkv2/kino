// How often does this markup have to be rasterized?
//
//   static  — once for the whole render
//   keyed   — once per distinct content key (active caption word, overlay text, …)
//   dynamic — every frame
//
// Getting this wrong in the `keyed` direction freezes a layer on screen with no error, so
// anything unrecognised resolves to `dynamic`. Cost is recoverable; a silently frozen layer
// in a shipped render is not.
export type RasterCadence = "static" | "keyed" | "dynamic";

/** Frame-driven custom properties set by the motion runtime every frame. */
const FRAME_VARS = /var\(\s*--(frame|t|progress|pulse)\b/;

/** Word-bound properties — these change on word boundaries, not per frame. */
const WORD_VARS = /var\(\s*--word[\w-]*/;

/** Any other author-defined custom property. Could be frame-driven; assume it is. */
const ANY_VAR = /var\(\s*--[\w-]+/;

/** A CSS animation is scrubbed per frame by the negative-delay trick. */
const CSS_ANIMATION = /@keyframes\b|\banimation\s*:/;

export function classifyRaster(html: string, opts: { hasTier2: boolean }): RasterCadence {
  if (opts.hasTier2) return "dynamic";
  if (FRAME_VARS.test(html)) return "dynamic";
  if (CSS_ANIMATION.test(html)) return "dynamic";

  const hasWordVar = WORD_VARS.test(html);
  // Strip the word vars, then ask whether any OTHER custom property remains.
  const withoutWordVars = html.replace(new RegExp(WORD_VARS.source, "g"), "");
  if (ANY_VAR.test(withoutWordVars)) return "dynamic";

  return hasWordVar ? "keyed" : "static";
}
