// @vitest-environment jsdom
// Two live clips in one frame (#28) — registry half. buildRegistry must give every declared
// video layer its own TextureSource keyed by its id, so two overlapping footage layers composite
// concurrently instead of one winning. jsdom for the same reason as layers-declared-registry:
// buildRegistry creates a Canvas2D source for a glow background.
import { describe, it, expect, vi } from "vitest";
import { buildRegistry } from "../src/render/native/page/compositor/registry.js";
import type { KinoProps } from "../src/render/props.js";
import type { MediaMap } from "../src/render/native/page/media.js";

vi.mock("lottie-web", () => ({ default: { loadAnimation: () => ({ isLoaded: true }) } }));

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0 } as unknown as import("../src/render/props.js").Theme;
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

const props = (): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, background: bg, disclosure: "",
  segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 4 }],
  layers: [
    { id: "bg", z: 300, source: { kind: "video", src: "bg.mp4", url: "bg.mp4" } },
    { id: "pip", z: 450, source: { kind: "video", src: "pip.mp4", url: "pip.mp4" }, rect: { x: 60, y: 55, w: 35, h: 40 }, fromSec: 1, toSec: 3 },
  ],
});

describe("two live clips — registry", () => {
  it("registers a texture source for each video layer", () => {
    const media: MediaMap = {
      bg: { dir: "bg", byFrame: { 0: "x000001.jpg" }, maxFrame: 0 },
      pip: { dir: "pip", byFrame: { 0: "x000001.jpg" }, maxFrame: 0 },
    };
    const reg = buildRegistry(props(), DIMS, DIMS, media, 1);
    expect(reg.has("bg")).toBe(true);
    expect(reg.has("pip")).toBe(true);
  });

  it("falls back to the staged url when a video layer's media entry is missing", () => {
    // Same fallback as seg{i}: a real entry if extraction produced one, else the resolved still
    // image (which for a missing entry is what the url points at). Not a silent nothing.
    const reg = buildRegistry(props(), DIMS, DIMS, {}, 1);
    expect(reg.has("bg")).toBe(true);
    expect(reg.has("pip")).toBe(true);
  });
});
