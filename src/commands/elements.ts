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
  process.stdout.write("    tween:     captionKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame)\n\n");
  process.stdout.write("  kicker (per app segment)\n");
  process.stdout.write("    tween:     kickerKeyframes [{ at, params: { x, y, scale, opacity }, ease? }]  (x/y offset, % of frame)\n");
  process.stdout.write("\nTimes are absolute on the main timeline — get per-word start/end from `kino inspect`.\n");
}
