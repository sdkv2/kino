// `*-4k` must be the SAME frame as its 1080-class twin, at 4× the pixels — not a different
// composition. Specs are authored in 1080-class px (74px captions, CAPTION_BOTTOM 470, absolute-px
// motion graphics), so a 4k render has to compose at the twin's canvas and gain its pixels as an
// output scale. Before the comp/out split, 4k composed at 2160-class directly and every authored
// px landed at half its intended relative size.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderStills } from "../src/render/render.js";
import { baseFormat, compDims } from "../src/render/formats.js";
import { magick } from "./magick.js";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};

const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: {
    kind: "glow", image: null, customCode: null, shaderCode: null,
    params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
    keyframes: [], triggers: [],
  },
  disclosure: "parity",
  segments: [{ kind: "scene", caption: "the quick brown fox", startSec: 0, endSec: 1 }],
};

const pngDims = (png: string): { width: number; height: number } => {
  const [w, h] = magick(["identify", "-format", "%w %h", png]).trim().split(" ").map(Number);
  return { width: w, height: h };
};

describe("compDims", () => {
  it("maps every format to its 1080-class authoring canvas", () => {
    expect(baseFormat("9:16-4k")).toBe("9:16");
    expect(baseFormat("9:16")).toBe("9:16");
    expect(compDims("9:16-4k")).toEqual({ width: 1080, height: 1920 });
    expect(compDims("16:9-4k")).toEqual({ width: 1920, height: 1080 });
    expect(compDims("3:4-4k")).toEqual({ width: 1080, height: 1440 });
    expect(compDims("9:16")).toEqual({ width: 1080, height: 1920 });
  });
});

describe("4k output parity", () => {
  it("renders 9:16-4k as the 9:16 frame at 4x the pixels, not a different composition", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-4k-"));
    const [hd] = await renderStills({
      props, publicDir: dir, format: "9:16", frames: [{ frame: 5, name: "hd" }], outDir: dir,
    });
    const [uhd] = await renderStills({
      props, publicDir: dir, format: "9:16-4k", frames: [{ frame: 5, name: "uhd" }], outDir: dir,
    });

    // Output really is UHD…
    expect(pngDims(uhd)).toEqual({ width: 2160, height: 3840 });
    expect(pngDims(hd)).toEqual({ width: 1080, height: 1920 });

    // …and it is the same frame. Downscaled to the twin's size, the caption (and everything
    // else) must land on the same pixels. The pre-fix composition put the caption at half its
    // relative size, which blows this way past any resampling tolerance.
    const shrunk = join(dir, "uhd-1080.png");
    magick([uhd, "-resize", "1080x1920!", "-strip", shrunk]);
    const rmse = parseFloat(
      magick([hd, shrunk, "-metric", "RMSE", "-compare", "-format", "%[distortion]", "info:"]).trim(),
    );
    expect(rmse).toBeLessThan(0.05);
  }, 300000);
});
