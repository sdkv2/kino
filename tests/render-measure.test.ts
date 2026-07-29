import { describe, it, expect } from "vitest";
import { renderStills, type FrameMeasure } from "../src/render/render.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };

describe("still --measure geometry probe", () => {
  it("reports layer-graph geometry (center + size) for composited layers", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-measure-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "scene", caption: "hook", startSec: 0, endSec: 2, motionOverlay: { html: "<div></div>", params: {}, keyframes: [], triggers: [] } }],
    };
    const measurements: FrameMeasure[] = [];
    await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "m" }], outDir, measureSink: measurements });

    expect(measurements).toHaveLength(1);
    const fm = measurements[0];
    expect(fm.width).toBe(1080);
    expect(fm.height).toBe(1920);

    const overlay = fm.elements.find((e) => e.label === "overlay0")!;
    expect(overlay).toBeDefined();
    expect(overlay.cxPct).toBeCloseTo(50, 1);
    expect(overlay.cyPct).toBeCloseTo(50, 1);
    expect(overlay.w).toBeCloseTo(1080, 0);
    expect(overlay.h).toBeCloseTo(1920, 0);
  }, 180000);

  it("collects nothing when no measureSink is passed (opt-in, zero overhead)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-measure-off-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "scene", caption: "hook", startSec: 0, endSec: 2, motionOverlay: { html: "<div></div>", params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "m" }], outDir });
    expect(outs).toHaveLength(1);
  }, 180000);
});
