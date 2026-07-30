import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

afterAll(closeGlHost);

type Wipe = { angle: number; softness: number; edgeWidth: number; edgeColor: [number, number, number]; edgeGain: number };

/** Default-ish wipe uniforms; the shader needs them supplied, exactly as the renderer does. */
const wipeAt = (angle: number, over: Partial<Wipe> = {}): Wipe => ({
  angle: (angle * Math.PI) / 180,
  softness: 0.018,
  edgeWidth: 0.013,
  edgeColor: [0.5, 0.89, 0.71],
  edgeGain: 0.55,
  ...over,
});

type Cam = { from: { zoom: number; panX: number; panY: number }; to: { zoom: number; panX: number; panY: number }; blur: number };

async function mixAt(kind: string, p: number, wipe?: Wipe, invert = false, cam?: Cam): Promise<number> {
  return glProbe<[string, number, Wipe | undefined, boolean, Cam | undefined], number>({
    entry: "src/render/native/page/compositor/transitions/index.ts",
    globalName: "KinoTx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (kind, p, wipe, invert, cam) =>
      (window as any).KinoTx.probeMix(document.getElementById("c") as HTMLCanvasElement, kind, p, wipe, invert, cam),
    args: [kind, p, wipe, invert, cam],
  });
}

describe("transition shaders", () => {
  for (const kind of ["fade", "dissolve", "fly-left", "fly-up", "wipe", "wipe-down", "wipe-up", "wipe-left", "wipe-right", "pop", "cut"]) {
    const w = kind.startsWith("wipe") ? wipeAt(0) : undefined;
    it(`${kind} is fully the outgoing beat at p=0`, async () => {
      expect(await mixAt(kind, 0, w)).toBeLessThanOrEqual(4);
    }, 120000);

    it(`${kind} is fully the incoming beat at p=1`, async () => {
      expect(await mixAt(kind, 1, w)).toBeGreaterThanOrEqual(251);
    }, 120000);
  }

  it("fade is monotonic through the middle", async () => {
    const [a, b] = [await mixAt("fade", 0.25), await mixAt("fade", 0.75)];
    expect(b).toBeGreaterThan(a);
  }, 240000);

  it("cut switches at the midpoint rather than blending", async () => {
    expect(await mixAt("cut", 0.49)).toBeLessThanOrEqual(4);
    expect(await mixAt("cut", 0.51)).toBeGreaterThanOrEqual(251);
  }, 240000);
});

describe("wipe", () => {
  // The reveal transition: the incoming frame is uncovered progressively behind a travelling edge,
  // instead of being slid in from off-screen (fly-*) or cross-faded in place (fade/dissolve).
  it("uncovers the incoming beat progressively rather than blending in place", async () => {
    // probeMix samples the CENTRE pixel, so the edge has passed it by the midpoint and not before.
    const early = await mixAt("wipe", 0.2, wipeAt(0));
    const late = await mixAt("wipe", 0.8, wipeAt(0));
    expect(late).toBeGreaterThan(early);
  }, 240000);

  it("reaches the centre at the halfway point for every axis", async () => {
    // Every direction crosses the centre pixel at p=0.5, so all four agree there. This is what
    // proves the projection is normalised per-angle rather than only correct for the vertical case.
    for (const a of [0, 90, 180, 270]) {
      expect(await mixAt("wipe", 0.42, wipeAt(a))).toBeLessThan(128);
      expect(await mixAt("wipe", 0.58, wipeAt(a))).toBeGreaterThan(128);
    }
  }, 480000);

  it("normalises a diagonal so it still runs fully off both corners", async () => {
    // A diagonal projects onto a longer axis than a cardinal one; without normalising by the
    // projected half-extent it would finish early and clip mid-sweep.
    expect(await mixAt("wipe", 0, wipeAt(45))).toBeLessThanOrEqual(4);
    expect(await mixAt("wipe", 1, wipeAt(45))).toBeGreaterThanOrEqual(251);
    expect(await mixAt("wipe", 0.42, wipeAt(45))).toBeLessThan(128);
    expect(await mixAt("wipe", 0.58, wipeAt(45))).toBeGreaterThan(128);
  }, 480000);

  it("keeps the endpoint contract exactly, despite the lit edge", async () => {
    // The glow is scaled by sin(pi*p), exactly 0 at both ends — a constant-strength band would
    // leave a hairline of light in the final frame and pop on the next beat. Test it at the
    // brightest setting, where any leak would be largest.
    const hot = wipeAt(0, { edgeWidth: 0.2, edgeGain: 4 });
    expect(await mixAt("wipe", 0, hot)).toBeLessThanOrEqual(4);
    expect(await mixAt("wipe", 1, hot)).toBeGreaterThanOrEqual(251);
  }, 240000);

  it("edgeWidth 0 disables the lit band without changing the reveal", async () => {
    // Sample just BEFORE the edge reaches the centre: the reveal has not started there yet, so any
    // brightening is the band alone. (The band is a narrow gaussian — sample it too early and it
    // legitimately reads zero, which is a bad test rather than a bug.)
    const unlit = await mixAt("wipe", 0.45, wipeAt(0, { edgeWidth: 0, edgeGain: 0 }));
    const lit = await mixAt("wipe", 0.45, wipeAt(0, { edgeWidth: 0.06, edgeGain: 2 }));
    expect(unlit).toBeLessThanOrEqual(4); // still purely the outgoing beat
    expect(lit).toBeGreaterThan(60);      // the band lights the same pixel
  }, 240000);

  it("softness widens the ramp through the centre", async () => {
    // Just before the edge arrives, a soft wipe has already begun blending; a hard one has not.
    const hard = await mixAt("wipe", 0.47, wipeAt(0, { softness: 0.001, edgeWidth: 0, edgeGain: 0 }));
    const soft = await mixAt("wipe", 0.47, wipeAt(0, { softness: 0.25, edgeWidth: 0, edgeGain: 0 }));
    expect(soft).toBeGreaterThan(hard);
  }, 240000);
});

describe("invert", () => {
  const KINDS = ["fade", "dissolve", "fly-left", "fly-up", "wipe", "pop", "cut"];

  // The whole point of implementing inversion as a double flip (1-p AND swapped inputs) rather than
  // just 1-p: the endpoint contract is preserved by construction, for every transition, including
  // author-supplied ones that know nothing about being inverted.
  for (const kind of KINDS) {
    const w = kind.startsWith("wipe") ? wipeAt(0) : undefined;
    it(`${kind} inverted still resolves to the outgoing beat at p=0`, async () => {
      expect(await mixAt(kind, 0, w, true)).toBeLessThanOrEqual(4);
    }, 120000);

    it(`${kind} inverted still resolves to the incoming beat at p=1`, async () => {
      expect(await mixAt(kind, 1, w, true)).toBeGreaterThanOrEqual(251);
    }, 120000);
  }

  it("reverses the sweep: inverted at p mirrors normal at 1-p", async () => {
    // probeMix mixes black `from` into white `to`. Inverting swaps the pair AND the clock, so the
    // centre pixel reads the complement of the un-inverted probe at the mirrored time.
    for (const p of [0.25, 0.5, 0.75]) {
      const normal = await mixAt("fade", 1 - p);
      const inverted = await mixAt("fade", p, undefined, true);
      expect(inverted).toBeCloseTo(255 - normal, -1);
    }
  }, 480000);

  it("an inverted wipe-down sweeps the same way as an un-inverted wipe-up", async () => {
    // Same direction of travel, opposite roles — which is exactly what "run it backwards" means.
    const unlit = { edgeWidth: 0, edgeGain: 0 };
    const down = await mixAt("wipe", 0.35, wipeAt(0, unlit), true);
    const up = 255 - (await mixAt("wipe", 0.65, wipeAt(180, unlit)));
    expect(down).toBeCloseTo(up, -1);
  }, 240000);

  it("is a no-op when false, so existing specs are untouched", async () => {
    expect(await mixAt("fade", 0.3, undefined, false)).toBe(await mixAt("fade", 0.3));
  }, 240000);
});

describe("camera through the transition", () => {
  const push: Cam = { from: { zoom: 0.18, panX: 0, panY: 0 }, to: { zoom: 0.18, panX: 0, panY: 0 }, blur: 0.5 };
  const whip: Cam = { from: { zoom: 0.06, panX: 0.42, panY: 0 }, to: { zoom: 0.06, panX: -0.42, panY: 0 }, blur: 1 };

  // The point of driving each side by its distance from its OWN endpoint: adding a camera can never
  // break a transition that was already exact there. Checked on every kind, not just one.
  for (const kind of ["fade", "dissolve", "fly-left", "fly-up", "wipe", "pop", "cut"]) {
    const w = kind.startsWith("wipe") ? wipeAt(0) : undefined;
    it(`${kind} keeps exact endpoints with a camera push`, async () => {
      expect(await mixAt(kind, 0, w, false, push)).toBeLessThanOrEqual(4);
      expect(await mixAt(kind, 1, w, false, push)).toBeGreaterThanOrEqual(251);
    }, 240000);
  }

  it("keeps exact endpoints with a hard whip and heavy smear", async () => {
    expect(await mixAt("fade", 0, undefined, false, whip)).toBeLessThanOrEqual(4);
    expect(await mixAt("fade", 1, undefined, false, whip)).toBeGreaterThanOrEqual(251);
  }, 240000);

  it("composes with invert without breaking endpoints", async () => {
    expect(await mixAt("wipe", 0, wipeAt(0), true, push)).toBeLessThanOrEqual(4);
    expect(await mixAt("wipe", 1, wipeAt(0), true, push)).toBeGreaterThanOrEqual(251);
  }, 240000);

  it("a still camera is a no-op — existing renders are untouched", async () => {
    const still: Cam = { from: { zoom: 0, panX: 0, panY: 0 }, to: { zoom: 0, panX: 0, panY: 0 }, blur: 0 };
    expect(await mixAt("fade", 0.4, undefined, false, still)).toBe(await mixAt("fade", 0.4));
  }, 240000);
});
