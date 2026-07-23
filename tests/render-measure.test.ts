import { describe, it, expect } from "vitest";
import { renderStills, type FrameMeasure } from "../src/render/render.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] };

// A centered box (inset+margin auto — the alignment-safe pattern) and a box pinned left:0 (deliberately
// off-center). The probe should report the first at frame center and the second offset by its half-width.
const html =
  `<div data-measure="centered" style="position:absolute;left:0;right:0;margin-inline:auto;top:40%;width:200px;height:100px"></div>` +
  `<div data-measure="pinned-left" style="position:absolute;left:0;top:10%;width:200px;height:100px"></div>`;

describe("still --measure geometry probe", () => {
  it("reports [data-measure] element centers + Δ-from-center across the shadow DOM", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-measure-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hook", startSec: 0, endSec: 2, motionOverlay: { html, params: {}, keyframes: [], triggers: [] } }],
    };
    const measurements: FrameMeasure[] = [];
    await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "m" }], outDir, measureSink: measurements });

    expect(measurements).toHaveLength(1);
    const fm = measurements[0];
    expect(fm.width).toBe(1080);
    expect(fm.height).toBe(1920);

    const centered = fm.elements.find((e) => e.label === "centered")!;
    expect(centered).toBeDefined();
    expect(Math.abs(centered.dxPct)).toBeLessThan(0.5); // dead-center horizontally
    expect(centered.w).toBeCloseTo(200, 0);

    const pinned = fm.elements.find((e) => e.label === "pinned-left")!;
    expect(pinned).toBeDefined();
    // left:0, width 200 → center at 100px = 9.26% → Δ from 50% ≈ -40.7%.
    expect(pinned.cx).toBeCloseTo(100, 0);
    expect(pinned.dxPct).toBeCloseTo(100 / 1080 * 100 - 50, 1);
  }, 180000);

  it("collects nothing when no measureSink is passed (opt-in, zero overhead)", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-measure-off-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hook", startSec: 0, endSec: 2, motionOverlay: { html, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "m" }], outDir });
    expect(outs).toHaveLength(1); // still returns the plain string[] of file paths
  }, 180000);
});
