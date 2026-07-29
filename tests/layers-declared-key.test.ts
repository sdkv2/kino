// A declared layer's source must carry a per-frame `key`, for the same reason every built-in
// motion layer does (layers.ts §5/§6 pass `key: String(beatLocal)`).
//
// Two things read it, and both break silently without it:
//
//   · providers/motion.ts `texture()` resolves `key ?? current ?? f:${local}`. With no key it
//     falls through to `current` — one mutable variable set by whichever prepare() ran last —
//     so the layer can draw a raster belonging to a different frame.
//   · prefetch.ts `keyId` is `${providerId}\0${key ?? ""}`, identical on every frame without a
//     key, so `nextFrameKeys` sees `cur.has(id)` and drops the layer from prefetch forever.
//
// Lottie and shader providers are stateless (prepare draws, texture returns the last canvas), so
// they were unaffected — which is why the symptom appeared only on beats carrying declared
// motion layers and cleared on the shader/lottie beat.
import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import { nextFrameKeys } from "../src/render/native/page/compositor/prefetch.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 0,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };

const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments, ...over,
});

const beats: KinoSegment[] = [
  { kind: "scene", caption: "a", startSec: 0, endSec: 2 },
  { kind: "scene", caption: "b", startSec: 2, endSec: 4 },
];

const hud = {
  id: "grid-hud",
  z: 755,
  source: { kind: "motion" as const, src: "motion/grid-hud.html" },
};

const layerAt = (p: KinoProps, frame: number, id: string) =>
  layersAt(p, frame, DIMS).find((l) => l.id === id)!;

describe("declared layer source keys", () => {
  it("advances the key every frame so the raster cache cannot serve a stale entry", () => {
    const p = mk(beats, { layers: [hud] });
    const k0 = layerAt(p, 0, "grid-hud").source!.key;
    const k1 = layerAt(p, 1, "grid-hud").source!.key;
    const k2 = layerAt(p, 2, "grid-hud").source!.key;

    expect(k0).toBeDefined();
    expect(k1).not.toBe(k0);
    expect(k2).not.toBe(k1);
  });

  it("keys layer-relative, so a beat-bound layer does not shift when its beat moves", () => {
    // Same layer bound to beat 1 (starts at 2s = frame 60). Its key at its own first frame must
    // match an unbound layer's key at frame 0 — the track is layer-relative, like the tween.
    const bound = mk(beats, { layers: [{ ...hud, segment: 1 }] });
    const free = mk(beats, { layers: [hud] });
    expect(layerAt(bound, 60, "grid-hud").source!.key).toBe(layerAt(free, 0, "grid-hud").source!.key);
  });

  it("is visible to the prefetcher, which dedupes on (providerId, key)", () => {
    // Without a per-frame key, keyId collides between consecutive frames and nextFrameKeys
    // skips the layer as "already prepared" — so it is never prefetched, on any frame, ever.
    const p = mk(beats, { layers: [hud] });
    const cur = layersAt(p, 10, DIMS);
    const next = layersAt(p, 11, DIMS);
    expect(nextFrameKeys(cur, next).map((k) => k.providerId)).toContain("grid-hud");
  });

  it("gives an adjustment layer no source at all, so it is never prefetched", () => {
    const p = mk(beats, { layers: [{ id: "grade", z: 350, adjust: [{ kind: "grade" as const, params: { contrast: 1.2 } }] }] });
    expect(layerAt(p, 10, "grade").source).toBeNull();
  });
});
