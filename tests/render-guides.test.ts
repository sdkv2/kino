// The --grid / --platform QA overlays. These were DOM-only (PlatformGuide.tsx) and silently
// stopped rendering when the compositor became the only path; they now live as Canvas2D draw
// functions. The layer-emission checks are cheap; the render check is what actually catches a
// regression back to "the flag parses but nothing draws".
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { layersAt } from "../src/render/layers.js";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};

const baseProps = (extra: Partial<KinoProps> = {}): KinoProps => ({
  theme,
  fps: 30,
  avatar: null,
  avatarWindows: [],
  voTrack: null,
  logo: null,
  background: {
    kind: "glow", image: null, customCode: null, shaderCode: null,
    params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
    keyframes: [], triggers: [],
  },
  disclosure: "",
  segments: [{ kind: "scene", caption: "hello", startSec: 0, endSec: 2 }],
  ...extra,
});

const DIMS = { width: 1080, height: 1920 };
const ids = (p: KinoProps) => layersAt(p, 10, DIMS).map((l) => l.id);

/** Mean red channel over a region, 0..1. */
const redAt = (png: string, geom: string): number =>
  parseFloat(magick([png, "-crop", geom, "+repage", "-format", "%[fx:mean.r]", "info:"]).trim());

describe("QA guide overlays", () => {
  it("emits no guide layers by default — `kino build` must never see them", () => {
    const layers = ids(baseProps());
    expect(layers).not.toContain("grid");
    expect(layers).not.toContain("platformGuide");
  });

  it("emits the grid layer above every content layer", () => {
    const layers = ids(baseProps({ grid: true }));
    expect(layers).toContain("grid");
    expect(layers.indexOf("grid")).toBe(layers.length - 1);
  });

  it("emits the platform layer beneath the grid when both are on", () => {
    const layers = ids(baseProps({ grid: true, platformGuide: "tiktok" }));
    expect(layers.indexOf("platformGuide")).toBeLessThan(layers.indexOf("grid"));
  });

  it("actually paints the tiktok safe zones red in a rendered still", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-guide-"));
    const [plain] = await renderStills({
      props: baseProps(),
      publicDir: mkdtempSync(join(tmpdir(), "kino-guide-p-")),
      format: "9:16",
      frames: [{ frame: 10, name: "plain" }],
      outDir,
    });
    const [guided] = await renderStills({
      props: baseProps({ platformGuide: "tiktok" }),
      publicDir: mkdtempSync(join(tmpdir(), "kino-guide-g-")),
      format: "9:16",
      frames: [{ frame: 10, name: "guided" }],
      outDir,
    });

    // All three zones must light up: top band (first 8%), bottom band (last 18%), right icon
    // rail (last 12% of width). A guide that draws only one of them is the failure mode worth
    // catching — the DOM version rendered them as three separate elements.
    // The measured lift is ~0.145; 0.10 leaves room for the label chip clipping a sample.
    for (const [zone, geom] of [
      ["top", "200x60+700+20"],
      ["bottom", "600x200+200+1650"],
      ["rail", "80x400+980+600"],
    ] as const) {
      expect(redAt(guided, geom), `${zone} zone`).toBeGreaterThan(redAt(plain, geom) + 0.1);
    }

    // The middle of the frame is outside every zone and must be untouched — the overlay is a
    // QA aid, so it must not perturb the pixels being QA'd.
    const middle = "400x200+200+900";
    expect(redAt(guided, middle)).toBe(redAt(plain, middle));
  }, 180000);
});
