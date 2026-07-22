import { LOGO_SIZES, LOGO_POSITIONS } from "../render/elements.js";

// Discovery: what overlay elements an agent can lay out + tween.
export async function elements(): Promise<void> {
  process.stdout.write("Overlay elements — agent-controllable layout + tween:\n\n");
  process.stdout.write("  logo\n");
  process.stdout.write(
    `    sizes:     ${Object.entries(LOGO_SIZES).map(([k, v]) => `${k} (${v}px)`).join(", ")}, or a custom number  — set logoSize\n`,
  );
  process.stdout.write(
    `    positions: ${Object.keys(LOGO_POSITIONS).join(", ")}, or custom { x, y } (% of frame)  — set logoPosition\n`,
  );
  process.stdout.write("    tween:     logoKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y are % of frame)\n\n");
  process.stdout.write("  caption (per segment)\n");
  process.stdout.write("    tween:     captionKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame)\n");
  process.stdout.write(
    "    backplate: brand captionStyle.background { color?, opacity?, appOnly? } — translucent panel behind lower-third captions for legibility over light app screens (opt-in; appOnly default true = app cut-ins only)\n\n",
  );
  process.stdout.write("  zoom — camera push/pan on the app footage + frame chrome group (the canvas zoom for inset device footage; captions/logo/bg stay put)\n");
  process.stdout.write("    tween:     zoomKeyframes [{ at, params: { scale, x, y, opacity }, ease? }]  (per app segment; x/y focal offset, % of frame)\n");
  process.stdout.write("\nPer-segment tracks (caption / zoom) use `at` = seconds from the beat's start (0 = beat start; they ride the beat when VO timing shifts).\n");
  process.stdout.write("The logo track is absolute on the main timeline — get per-word start/end from `kino inspect`.\n");
}
