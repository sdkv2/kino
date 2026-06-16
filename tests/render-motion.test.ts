import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };
const html = `<style>.bar{position:absolute;left:10%;bottom:20%;height:40px;width:calc(var(--pct)*1%);background:var(--kino-mint)}</style><div class="bar"></div>`;

describe("motion graphics render", () => {
  it("renders a still of a motion segment (CSS-variable bar)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgr-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "motion", caption: "", startSec: 0, endSec: 2,
          motion: { html, params: { pct: 0 }, keyframes: [{ at: 0.2, params: { pct: 86 } }], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 30, name: "mg" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0]) && outs[0].endsWith(".png")).toBe(true);
  }, 180000);

  it("renders a motionOverlay on an avatar beat", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-mgo-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [
        { kind: "avatar", caption: "hook", startSec: 0, endSec: 2,
          motionOverlay: { html, params: { pct: 50 }, keyframes: [], triggers: [] } },
      ],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "ov" }], outDir });
    expect(outs).toHaveLength(1);
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});
