import { describe, it, expect } from "vitest";
import { prepare } from "../src/commands/build.js";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const meanDiff = (a: string, b: string) =>
  parseFloat(magick([a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim());

describe("motion over shader backgrounds", () => {
  it("composites without caption when motion vars stay in the style block", async () => {
    const r = await prepare("projects/compositor-demo/specs/showcase.json", {
      mock: true, format: "9:16", project: "compositor-demo",
    });
    const seg = r.props.segments[1]!;
    const motionOnly = {
      ...r.props,
      segments: [{
        ...seg,
        caption: "",
        startSec: 0,
        endSec: 10,
        motionOverlay: undefined,
        motion: {
          html: `<style>.s{position:absolute;inset:0;background:repeating-linear-gradient(90deg,#000 0 32px,#fff 32px 64px)}</style><div class="s"></div>`,
          params: {}, keyframes: [], triggers: [],
        },
      }],
    };
    const outDir = mkdtempSync(join(tmpdir(), "kino-motshader-"));
    const [withMotion, backdrop] = await Promise.all([
      renderStills({ props: motionOnly, publicDir: r.publicDir, format: "9:16", frames: [{ frame: 20, name: "m" }], outDir }),
      renderStills({ props: { ...r.props, segments: [] }, publicDir: r.publicDir, format: "9:16", frames: [{ frame: 20, name: "bg" }], outDir }),
    ]);
    expect(meanDiff(withMotion[0], backdrop[0])).toBeGreaterThan(0.001);
  }, 180000);
});
