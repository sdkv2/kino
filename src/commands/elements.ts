import { LAYER_SOURCE_KINDS } from "../render/layerSpec.js";
import { BLEND_MODES } from "../render/blendModes.js";

// Discovery: what overlay elements an agent can lay out + tween.
export async function elements(): Promise<void> {
  process.stdout.write("Overlay elements — agent-controllable layout + tween:\n\n");
  process.stdout.write("  caption (per segment)\n");
  process.stdout.write("    tween:     captionKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame)\n");
  process.stdout.write(
    "    backplate: brand captionStyle.background { color?, opacity?, appOnly? } — translucent panel behind lower-third captions for legibility over light app screens (opt-in; appOnly default true = app cut-ins only)\n\n",
  );
  process.stdout.write("  kicker (per app segment)\n");
  process.stdout.write("    tween:     kickerKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame)\n\n");
  process.stdout.write("  zoom — camera push/pan on the app footage + frame chrome group (the canvas zoom for inset device footage; captions/bg stay put)\n");
  process.stdout.write("    tween:     zoomKeyframes [{ at, params: { scale, x, y, opacity }, ease? }]  (per app segment; x/y focal offset, % of frame)\n\n");
  process.stdout.write("  layers (spec.layers[], one entry per declared layer)\n");
  process.stdout.write(
    `    sources:   ${LAYER_SOURCE_KINDS.join(", ")}  (video only resolves a still image today — a real .mp4/.mov is not wired up yet)  — set source.kind + source.src\n`,
  );
  process.stdout.write(
    "    z:         picks paint order against the built-in stack (Z.backdrop 0 .. Z.qa 9000, src/render/layers.ts) — pick a value between two built-ins, never one of them\n",
  );
  process.stdout.write(`    blend:     ${BLEND_MODES.join(", ")}  (default normal)  — also settable per video/motion segment\n`);
  process.stdout.write(
    "    tween:     keyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame; at is relative to the layer's own start, not absolute)\n\n",
  );
  process.stdout.write("Per-segment tracks (caption / kicker / zoom) use `at` = seconds from the beat's start (0 = beat start; they ride the beat when VO timing shifts).\n");
}
