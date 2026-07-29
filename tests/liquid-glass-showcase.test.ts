import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { prepare } from "../src/commands/build.js";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const html = readFileSync("projects/compositor-demo/assets/motion/liquid-glass.html", "utf8");
const stripes =
  "const w=ctx.canvas.width,h=ctx.canvas.height;for(let x=0;x<w;x+=64){ctx.fillStyle=((x/64)%2)?'#ffffff':'#000000';ctx.fillRect(x,0,64,h);}";

const std = (p: string) =>
  parseFloat(magick([p, "-crop", "400x400+340+760", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim());

describe("liquid-glass showcase", () => {
  it("kino-lens refracts a busy field (stripe control)", async () => {
    const theme = {
      font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
      gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
    };
    const bg = {
      kind: "custom" as const, image: null, shaderCode: null, customCode: stripes,
      params: {}, keyframes: [], triggers: [],
    };
    const mk = (h: string): KinoProps => ({
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: bg, disclosure: "",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2, motion: { html: h, params: {}, keyframes: [], triggers: [] } }],
    });
    const outDir = mkdtempSync(join(tmpdir(), "lg-"));
    const noGlass = html.replace(" kino-lens", "");
    const [plain, glass] = await Promise.all([
      renderStills({ props: mk(noGlass), publicDir: mkdtempSync(join(tmpdir(), "p1-")), format: "9:16", frames: [{ frame: 30, name: "plain" }], outDir }),
      renderStills({ props: mk(html), publicDir: mkdtempSync(join(tmpdir(), "p2-")), format: "9:16", frames: [{ frame: 30, name: "glass" }], outDir }),
    ]);
    expect(std(plain[0])).toBeGreaterThan(0.02);
    expect(std(glass[0])).toBeGreaterThan(0.02);
    expect(
      parseFloat(magick([plain[0], glass[0], "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"]).trim()),
    ).toBeGreaterThan(0.003);
  }, 180000);

  it("showcase overlay refracts stripes through glass", async () => {
    const r = await prepare("projects/compositor-demo/specs/showcase.json", {
      mock: true, format: "9:16", project: "compositor-demo",
    });
    const outDir = mkdtempSync(join(tmpdir(), "lg-show-"));
    const [png] = await renderStills({
      props: r.props, publicDir: r.publicDir, format: "9:16",
      frames: [{ frame: 30, name: "showcase" }], outDir,
    });
    const stddev = parseFloat(
      magick([png, "-crop", "760x760+160+580", "+repage", "-format", "%[fx:standard_deviation]", "info:"]).trim(),
    );
    expect(stddev).toBeGreaterThan(0.05);
  }, 180000);
});
