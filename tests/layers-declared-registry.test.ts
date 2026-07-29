// @vitest-environment jsdom
// Every declared layer must get a TextureSource under its own id. layersAt and buildRegistry
// share one id namespace; a mismatch is a silently missing layer, which is exactly the failure
// the registry's own header comment warns about.
import { describe, it, expect, vi } from "vitest";

// registry.ts statically imports every provider, including providers/lottie.ts -> "lottie-web".
// That module runs browser-canvas feature detection at IMPORT time (not lazily), which throws
// under jsdom because jsdom's canvas has no 2D context without the optional "canvas" npm package
// — unrelated to anything this test exercises. None of these tests call .prepare()/.texture(), so
// a minimal stub that satisfies the import is enough; real lottie playback is Task 8+GPU-test
// territory, not this file's concern.
vi.mock("lottie-web", () => ({ default: { loadAnimation: () => ({ isLoaded: true }) } }));

import { buildRegistry } from "../src/render/native/page/compositor/registry.js";
import type { KinoProps } from "../src/render/props.js";
import type { MediaMap } from "../src/render/native/page/media.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const noMedia: MediaMap = {};

const props = (layers: KinoProps["layers"]): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", layers,
  segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }],
});

// Task 7b: build.ts resolves `source.src` node-side into url/shaderCode/graphic before a layer
// ever reaches KinoProps (see layerSpec.ts's DeclaredLayerSource comment and build.ts's
// resolveDeclaredLayers) — registry.ts reads only those resolved fields now, never `src` directly.
// These fixtures construct KinoProps by hand (bypassing build.ts), so they supply the resolved
// field themselves, exactly like a real resolution pass would have.
describe("declared layers in the registry", () => {
  it("registers an image layer under its id", () => {
    const reg = buildRegistry(
      props([{ id: "leak", z: 350, source: { kind: "image", src: "fx/leak.png", url: "fx/leak.png" } }]),
      DIMS, DIMS, noMedia, 1,
    );
    expect(reg.has("leak")).toBe(true);
  });

  it("registers each source kind", () => {
    // "video" needs a pre-extracted MediaEntry keyed under the layer's own id — buildRegistry only
    // CONSUMES the media map (mirroring how it consumes media["seg{i}"]); nothing yet PRODUCES an
    // entry for a declared video layer (planMediaJobs/videoFrames.ts don't walk props.layers). So
    // this fixture supplies one directly, exactly like a real extraction pass would, to exercise
    // the real createFramesSource path instead of asserting something no pipeline stage can supply.
    const media: MediaMap = { d: { dir: "d", byFrame: { 0: "d/000.png" }, maxFrame: 0 } };
    const reg = buildRegistry(props([
      { id: "a", z: 310, source: { kind: "image", src: "a.png", url: "a.png" } },
      { id: "b", z: 320, source: { kind: "motion", src: "b.html", graphic: { html: "<div></div>", params: {}, keyframes: [], triggers: [] } } },
      { id: "c", z: 330, source: { kind: "shader", src: "c.frag", shaderCode: "vec4 mainImage() { return vec4(1.0); }" } },
      { id: "d", z: 340, source: { kind: "video", src: "d.mp4", url: "d.mp4" } },
      { id: "e", z: 350, source: { kind: "lottie", src: "e.json", graphic: { html: "", lottie: { v: "5.5.7" }, params: {}, keyframes: [], triggers: [] } } },
    ]), DIMS, DIMS, media, 1);
    for (const id of ["a", "b", "c", "d", "e"]) expect(reg.has(id)).toBe(true);
  });

  it("registers nothing for an adjustment layer, which has no pixels", () => {
    const reg = buildRegistry(props([{ id: "grade", z: 350, adjust: [{ kind: "grade", params: { contrast: 1.2 } }] }]), DIMS, DIMS, noMedia, 1);
    expect(reg.has("grade")).toBe(false);
  });

  // A declared "video" layer with no media entry and no resolved `url` (i.e. never went through
  // build.ts's resolution pass, which would otherwise have staged it or thrown): the same
  // silent-no-registration behaviour `seg{i}` already has in this exact situation (registry.ts's
  // segment loop, `else if (s.source && /\.(jpe?g|png|webp)$/i.test(...))`) — not a new gap.
  it("registers nothing for an unresolved video layer (no media entry, no resolved url)", () => {
    const reg = buildRegistry(props([{ id: "ghost", z: 340, source: { kind: "video", src: "ghost.mp4" } }]), DIMS, DIMS, noMedia, 1);
    expect(reg.has("ghost")).toBe(false);
  });

  // The resolved-url fallback a "video" kind layer gets when no media entry exists — mirrors the
  // identical fallback already used for `seg{i}` video beats pointed at a still image. In a real
  // build this `url` is only ever populated for a still image (resolveDeclaredLayers rejects a
  // real video file outright — see build.ts), so the extension no longer needs rechecking here.
  it("falls back to the resolved still image for a video-kind layer with no media entry", () => {
    const reg = buildRegistry(
      props([{ id: "poster", z: 340, source: { kind: "video", src: "poster.png", url: "poster.png" } }]),
      DIMS, DIMS, noMedia, 1,
    );
    expect(reg.has("poster")).toBe(true);
  });
});
