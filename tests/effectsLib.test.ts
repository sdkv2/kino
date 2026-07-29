import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EFFECTS_LIB_DIR,
  DEFAULT_LENS_ID,
  collectLensIds,
  collectLensShaders,
  resolveEffectComponent,
  attachLensShaders,
  hydratePropsLensShaders,
} from "../src/media/effectsLib.js";
import { LENS_CLASS_RE } from "../src/render/lensContract.js";
import type { KinoProps } from "../src/render/props.js";

describe("effectsLib", () => {
  it("resolves bare id liquid-glass to assets-lib/effects", () => {
    const path = resolveEffectComponent(DEFAULT_LENS_ID);
    expect(path).toBe(join(EFFECTS_LIB_DIR, "liquid-glass.frag"));
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toMatch(/#version 300 es/);
  });

  it("collectLensIds picks default + data-lens overrides", () => {
    expect(collectLensIds(`<div class="card">plain</div>`)).toBeNull();
    expect(collectLensIds(`<div class="kino-lens"></div>`)).toEqual([DEFAULT_LENS_ID]);
    expect(collectLensIds(`<div class="kino-lens" data-lens="prism"></div>`)).toEqual(
      expect.arrayContaining([DEFAULT_LENS_ID, "prism"]),
    );
  });

  it("LENS_CLASS_RE matches kino-lens and kino-lens", () => {
    expect(LENS_CLASS_RE.test("class='kino-lens'")).toBe(true);
    expect(LENS_CLASS_RE.test('class="kino-lens"')).toBe(true);
    expect(LENS_CLASS_RE.test("class='kino-grain'")).toBe(false);
  });

  it("collectLensShaders loads default frag source", () => {
    const map = collectLensShaders(`<div class="kino-lens"></div>`);
    expect(map?.[DEFAULT_LENS_ID]).toMatch(/uStrength/);
  });

  it("attachLensShaders / hydratePropsLensShaders fill missing maps", () => {
    const motion = attachLensShaders({
      html: `<div class="kino-lens"></div>`,
      params: {},
      keyframes: [],
      triggers: [],
    });
    expect(motion.lensShaders?.[DEFAULT_LENS_ID]).toBeTruthy();

    const theme = {
      font: "Arial", night: "#000", mint: "#0f0", green: "#0a0",
      gold: "#aa0", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
    };
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
      background: {
        kind: "custom", image: null, shaderCode: null,
        customCode: "ctx.fillRect(0,0,1,1)", params: {}, keyframes: [], triggers: [],
      },
      disclosure: "",
      segments: [{
        kind: "motion", caption: "", startSec: 0, endSec: 1,
        motion: { html: `<div class="kino-lens"></div>`, params: {}, keyframes: [], triggers: [] },
      }],
    };
    const hydrated = hydratePropsLensShaders(props);
    expect(hydrated.segments[0].kind === "motion" && hydrated.segments[0].motion?.lensShaders?.[DEFAULT_LENS_ID]).toBeTruthy();
  });
});
