// @vitest-environment jsdom
// Every declared layer must get a TextureSource under its own id. layersAt and buildRegistry
// share one id namespace; a mismatch is a silently missing layer, which is exactly the failure
// the registry's own header comment warns about.
import { describe, it, expect, vi, beforeEach } from "vitest";

// registry.ts statically imports every provider, including providers/lottie.ts -> "lottie-web".
// That module runs browser-canvas feature detection at IMPORT time (not lazily), which throws
// under jsdom because jsdom's canvas has no 2D context without the optional "canvas" npm package
// — unrelated to anything this test exercises. None of these tests call .prepare()/.texture(), so
// a minimal stub that satisfies the import is enough; real lottie playback is Task 8+GPU-test
// territory, not this file's concern.
vi.mock("lottie-web", () => ({ default: { loadAnimation: () => ({ isLoaded: true }) } }));

// Finding 3: build.ts sets `url: src` for both image and video in production, so every
// image/video fixture elsewhere in this file has a `url` byte-identical to its `src` — a registry
// that read `d.source.src` instead of `d.source.url` would pass every one of them. These two
// mocks let the discrimination tests below assert on the actual argument buildRegistry hands the
// provider, not just `reg.has(id)`.
const imageSourceCalls: string[] = [];
vi.mock("../src/render/native/page/compositor/providers/image.js", () => ({
  createImageSource: vi.fn((url: string) => {
    imageSourceCalls.push(url);
    return { prepare: async () => {}, texture: () => null, size: () => null };
  }),
}));

// Finding 1: the registry-level half of the publishBackdrop wiring — createShaderSource itself is
// unit-tested directly (tests/shader-source-backdrop.test.ts); this mock instead proves
// buildRegistry passes `publishBackdrop: false` for a declared shader layer while leaving the real
// backdrop shader's call alone (defaulting to true, unchanged behaviour).
const shaderSourceOpts: Array<{ publishBackdrop?: boolean }> = [];
vi.mock("../src/render/native/page/compositor/providers/shader.js", () => ({
  createShaderSource: vi.fn((opts: { publishBackdrop?: boolean }) => {
    shaderSourceOpts.push({ publishBackdrop: opts.publishBackdrop });
    return { prepare: async () => {}, texture: () => null, size: () => null };
  }),
}));

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
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", layers,
  segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }],
});

// Task 7b: build.ts resolves `source.src` node-side into url/shaderCode/graphic before a layer
// ever reaches KinoProps (see layerSpec.ts's DeclaredLayerSource comment and build.ts's
// resolveDeclaredLayers) — registry.ts reads only those resolved fields now, never `src` directly.
// These fixtures construct KinoProps by hand (bypassing build.ts), so they supply the resolved
// field themselves, exactly like a real resolution pass would have.
describe("declared layers in the registry", () => {
  beforeEach(() => {
    imageSourceCalls.length = 0;
    shaderSourceOpts.length = 0;
  });

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

  // Finding 3: `src` and `url` are deliberately DIFFERENT here (every other fixture in this file
  // has them byte-identical, matching what build.ts actually produces — `url: src` — so none of
  // them could ever catch a registry that read the wrong field). If registry.ts read
  // `d.source.src` instead of `d.source.url`, this would assert the raw (unresolved) value instead
  // and fail.
  it("passes the resolved source.url to the image provider, not the raw src", () => {
    const reg = buildRegistry(
      props([{ id: "leakUrl", z: 355, source: { kind: "image", src: "fx/leak-original.png", url: "fx/leak-resolved.png" } }]),
      DIMS, DIMS, noMedia, 1,
    );
    expect(reg.has("leakUrl")).toBe(true);
    expect(imageSourceCalls).toContain("/public/fx/leak-resolved.png");
    expect(imageSourceCalls).not.toContain("/public/fx/leak-original.png");
  });

  it("passes the resolved source.url to the image provider for a video-kind still-image fallback, not the raw src", () => {
    const reg = buildRegistry(
      props([{ id: "posterUrl", z: 356, source: { kind: "video", src: "posters/raw-name.png", url: "posters/resolved-name.png" } }]),
      DIMS, DIMS, noMedia, 1,
    );
    expect(reg.has("posterUrl")).toBe(true);
    expect(imageSourceCalls).toContain("/public/posters/resolved-name.png");
    expect(imageSourceCalls).not.toContain("/public/posters/raw-name.png");
  });

  // Finding 1 (registry-level half — see tests/shader-source-backdrop.test.ts for the provider's
  // own behaviour under each option): a declared shader layer must opt OUT of the backdrop bus,
  // while the real backdrop shader's call must be left alone (defaulting to true unchanged).
  it("passes publishBackdrop: false for a declared shader layer but not for the real backdrop shader", () => {
    const shaderProps: KinoProps = {
      ...props([{ id: "declaredShader", z: 357, source: { kind: "shader", src: "c.frag", shaderCode: "vec4 mainImage(){return vec4(1.0);}" } }]),
      background: {
        kind: "custom", image: null, customCode: null,
        shaderCode: "vec4 mainImage(){return vec4(1.0);}",
        params: {}, keyframes: [], triggers: [],
      },
    };
    const reg = buildRegistry(shaderProps, DIMS, DIMS, noMedia, 1);
    expect(reg.has("backdrop")).toBe(true);
    expect(reg.has("declaredShader")).toBe(true);
    // Order follows buildRegistry's own body: the backdrop is built before the declared-layer loop.
    expect(shaderSourceOpts[0]).toEqual({ publishBackdrop: undefined });
    expect(shaderSourceOpts[1]).toEqual({ publishBackdrop: false });
  });
});
