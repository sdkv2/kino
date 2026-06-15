import { execa } from "execa";
import { existsSync } from "node:fs";

export interface Tile {
  path: string;
  label: string;
}

// Tile labeled stills into one contact sheet. Tries ImageMagick `montage` then IM7 `magick montage`;
// some IM builds exit non-zero on a benign warning yet still write the file, so we treat a written
// output as success and only throw if nothing was produced.
export async function montage(tiles: Tile[], out: string, opts: { cols?: number; bg?: string; font?: string } = {}): Promise<void> {
  const cols = opts.cols ?? Math.min(4, Math.ceil(Math.sqrt(tiles.length)));
  const args: string[] = [];
  if (opts.font) args.push("-font", opts.font); // crisp labels in a known TTF
  for (const t of tiles) args.push("-label", t.label, t.path);
  args.push("-tile", `${cols}x`, "-geometry", "300x+10+8", "-background", opts.bg ?? "#0b1020", "-fill", "#cbd5e1", "-pointsize", "20", out);

  for (const [bin, a] of [["montage", args], ["magick", ["montage", ...args]]] as const) {
    try {
      await execa(bin, a);
      return;
    } catch {
      if (existsSync(out)) return; // wrote the file despite a warning-exit
    }
  }
  if (!existsSync(out)) throw new Error("montage failed — is ImageMagick installed? (brew install imagemagick)");
}
