// The ordered walk: an adjustment layer runs over everything beneath it — INCLUDING a
// transitioning beat, which the old post-hoc transition block composited after the film pass had
// already run. Plus the thing no pixel assertion catches: that the restructured walk returns every
// render target it acquires, on the transition path as well as the plain one.
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import { groupSpans, transitionProgress } from "../src/render/transitionSpec.js";
import type { KinoProps } from "../src/render/props.js";

afterAll(closeGlHost);

const ENTRY = "src/render/native/page/compositor/renderer.ts";
const GLOBAL = "KinoRenderer";
const HTML = `<!doctype html><body style="margin:0"><canvas id="c" width="200" height="200"></canvas></body>`;
const FRAME_UNDER_TEST = 66;

// Mirrors the `props.segments`/`fps` built inside walk()'s glProbe fn. That fn is serialised via
// toString() and cannot close over anything in this file (see glHost.ts), so the transition
// timing is re-derived here, at the Node side, from the same two-beat shape — purely to assert
// this test's own premise, not to duplicate the GL probe itself.
const TRANSITION_PROPS = {
  fps: 30,
  segments: [
    { kind: "video", source: "a.mp4", caption: "a", startSec: 0, endSec: 2, transition: "cut" },
    { kind: "video", source: "b.mp4", caption: "b", startSec: 2, endSec: 4, transition: "fade" },
  ],
} as unknown as KinoProps;

interface WalkProbe {
  /** Canvas corner and centre luma at the crossfade midpoint, with the finish on and off. */
  filmOn: { corner: number; centre: number };
  filmOff: { corner: number; centre: number };
  /** Targets the pool had ever allocated, after warm-up and after many more frames. */
  poolAfterWarmup: number;
  poolAfterMany: number;
  /** Free-list entries after the "many" pass, and how many of those entries are distinct
   *  objects. A double-release pushes the same target onto a free bucket twice — `all.length`
   *  does not move (acquire() was never called again), but the free list gains a duplicate
   *  reference, so these two counts diverge. */
  freeListLength: number;
  freeListUniqueLength: number;
}

/**
 * Two overlapping video beats, so `transitionProgress` reports a crossfade. groupSpans gives
 * beat0 [0, 72) (chained: f(2s)=60 plus the 12-frame hold) and beat1 [60, 120), so frames 60..72
 * are the overlap and frame 66 is p = 0.5.
 */
async function walk(): Promise<WalkProbe> {
  return glProbe<[], WalkProbe>({
    entry: ENTRY,
    globalName: GLOBAL,
    html: HTML,
    fn: () => {
      const solid = (color: string) => {
        const c = document.createElement("canvas");
        c.width = 200;
        c.height = 200;
        const ctx = c.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 200, 200);
        return c;
      };
      const src = (canvas: HTMLCanvasElement) => {
        let tex: WebGLTexture | null = null;
        return {
          prepare: async () => {},
          size: () => ({ w: 200, h: 200 }),
          texture: (gl: WebGL2RenderingContext) => {
            if (!tex) {
              tex = gl.createTexture();
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
            }
            return tex;
          },
        };
      };

      const theme = {
        font: "Arial", night: "#0b1020", mint: "#0f0", green: "#0f0", gold: "#fc0",
        white: "#fff", captionFontSize: 74, captionStroke: 9,
      };
      const props = {
        theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
        background: { kind: "custom", image: null, shaderCode: null, customCode: "", params: {}, keyframes: [], triggers: [] },
        disclosure: "",
        segments: [
          { kind: "video", source: "a.mp4", caption: "a", startSec: 0, endSec: 2, transition: "cut" },
          { kind: "video", source: "b.mp4", caption: "b", startSec: 2, endSec: 4, transition: "fade" },
        ],
      };

      const full = { x: 0, y: 0, w: 200, h: 200 };
      const base = {
        rect: full, transform: { scale: 1, rotate: 0, translate: [0, 0] },
        opacity: 1, blend: "normal", effects: [], textGamma: 1,
      };
      // Sorted by z, as layersAt returns them: the two beats' footage, then the finish, then
      // the two beats' captions — so the finish splits each beat across it.
      const layers = (filmIntensity: number) => [
        { ...base, id: "backdrop", z: 0, source: { providerId: "bg" } },
        { ...base, id: "seg0", z: 300, source: { providerId: "white" }, group: "beat0" },
        { ...base, id: "seg1", z: 300, source: { providerId: "white" }, group: "beat1" },
        ...(filmIntensity > 0
          ? [{
              ...base, id: "film", z: 700, source: null,
              adjust: [{ kind: "film", params: { intensity: filmIntensity } }],
            }]
          : []),
        { ...base, id: "caption0", z: 1100, source: { providerId: "dot" }, group: "beat0" },
        { ...base, id: "caption1", z: 1100, source: { providerId: "dot" }, group: "beat1" },
      ];

      const canvas = document.getElementById("c") as HTMLCanvasElement;
      const r = new (window as any).KinoRenderer.StageRenderer(canvas, { width: 200, height: 200, ss: 1 });
      const sources = new Map<string, any>([
        ["bg", src(solid("#202020"))],
        ["white", src(solid("#ffffff"))],
        ["dot", src(solid("rgba(255,0,0,0.25)"))],
      ]);

      const read = document.createElement("canvas");
      read.width = 200;
      read.height = 200;
      const rctx = read.getContext("2d")!;
      const sample = (filmIntensity: number, frame: number) => {
        r.draw(layers(filmIntensity), sources, frame, { theme, props });
        rctx.clearRect(0, 0, 200, 200);
        rctx.drawImage(canvas, 0, 0);
        return {
          corner: rctx.getImageData(2, 2, 1, 1).data[1],
          centre: rctx.getImageData(100, 100, 1, 1).data[1],
        };
      };

      // Frame 66 is the crossfade midpoint. Both beats are on screen and neither composites
      // directly — the walk mixes them where they stand.
      const filmOn = sample(1, 66);
      const filmOff = sample(0, 66);

      // Leak watch. The pool never frees, it recycles, so `all.length` is the high-water mark of
      // simultaneously-live targets. Warm up over every path — plain frame, adjustment frame,
      // transition frame — then run many more of the same and require the mark not to move.
      const pool = (r as any).pool;
      for (const f of [10, 66, 100]) { sample(1, f); sample(0, f); }
      const poolAfterWarmup = pool.all.length;
      for (let i = 0; i < 12; i++) for (const f of [10, 66, 100]) { sample(1, f); sample(0, f); }
      const poolAfterMany = pool.all.length;

      // Duplicate watch. `all.length` only grows on an `acquire()` cache miss, so a double
      // `release()` of the same target is invisible to it — the target just gets pushed onto
      // its size bucket in the free list twice. Flatten every bucket and compare the entry
      // count against a Set's size: a duplicate object reference collapses in the Set but not
      // in the array, so the two counts diverge exactly when a double-release has happened.
      const freeEntries: unknown[] = [];
      for (const bucket of pool.free.values()) freeEntries.push(...bucket);
      const freeListLength = freeEntries.length;
      const freeListUniqueLength = new Set(freeEntries).size;

      return { filmOn, filmOff, poolAfterWarmup, poolAfterMany, freeListLength, freeListUniqueLength };
    },
  });
}

describe("the ordered walk", () => {
  it("applies the film adjustment to a transitioning beat, which the old order could not", async () => {
    // Pin the test's own premise: frame 66 must actually be mid-transition, or the assertions
    // below would pass just as well on a plain, non-transitioning frame and silently stop
    // testing what this test is named for.
    const win = transitionProgress({ groups: groupSpans(TRANSITION_PROPS), frame: FRAME_UNDER_TEST });
    expect(win).not.toBeNull();
    expect(win?.from).toBe("beat0");
    expect(win?.to).toBe("beat1");
    expect(win?.p).toBeCloseTo(0.5, 5);

    const p = await walk();
    // With the finish off the frame is flat: the mixed footage is one solid white either way.
    expect(p.filmOff.corner).toBe(p.filmOff.centre);
    // With it on, the vignette darkens the corner of the MIXED footage. Under the old structure
    // the mix was blitted after the film pass had run, so this corner was untouched.
    expect(p.filmOn.corner).toBeLessThan(p.filmOn.centre - 8);
    expect(p.filmOn.corner).toBeLessThan(p.filmOff.corner - 8);
  }, 120000);

  it("returns every target it acquires, on the transition path too", async () => {
    const p = await walk();
    expect(p.poolAfterWarmup).toBeGreaterThan(0);
    expect(p.poolAfterMany).toBe(p.poolAfterWarmup);
    // A double-release (handing one target to two later acquires — a use-after-free) would
    // make `all.length` grow MORE slowly, so the assertion above could pass while masking it.
    // Catch that direction too: the free list must never hold the same target twice.
    expect(p.freeListUniqueLength).toBe(p.freeListLength);
  }, 120000);
});
