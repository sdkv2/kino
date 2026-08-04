// Veiling glare, and the one property that distinguishes it from a preset: the SAME parameters
// must produce a different lift on a dark frame than on a bright one.
//
// So every probe here renders a black frame with a white disc of a given radius and reads the
// corner — a pixel the disc never touches. A constant black lift would move that corner by the
// same amount for every radius; a measured one moves it in proportion to how much of the frame is
// lit. The whole feature is that difference.
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import { validatePostFx } from "../src/render/postSpec.js";
import { validateLayers } from "../src/render/layerSpec.js";

afterAll(closeGlHost);

/** [cornerR, cornerG, cornerB, discR] after the post chain, 0..255. */
type Reading = [number, number, number, number];

/**
 * Run the tail post chain over a black frame carrying one centred disc.
 *
 * `discFrac` is the disc radius as a fraction of the frame's half-width, so 0 is an unlit frame
 * and ~1 fills it. `discColour` lets a test check that the glare takes the light's colour.
 */
function veil(postFx: Record<string, unknown>, discFrac: number, discColour = "#ffffff"): Promise<Reading> {
  return glProbe<[Record<string, unknown>, number, string], Reading>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`,
    fn: (postFx: Record<string, unknown>, discFrac: number, discColour: string) =>
      (window as any).KinoFx.probeVeil(
        document.getElementById("c") as HTMLCanvasElement,
        postFx,
        discFrac,
        discColour,
      ),
    args: [postFx, discFrac, discColour],
  });
}

describe("veil: content response", () => {
  it("does nothing at all when the stage is absent", async () => {
    const [r, g, b] = await veil({}, 0.5);
    expect([r, g, b]).toEqual([0, 0, 0]);
  }, 300000);

  it("leaves an unlit frame black — no light, no scatter", async () => {
    const [r, g, b] = await veil({ veil: { amount: 0.4 } }, 0);
    expect([r, g, b]).toEqual([0, 0, 0]);
  }, 300000);

  it("lifts the black corner once something bright is on screen", async () => {
    const [r] = await veil({ veil: { amount: 0.4 } }, 0.5);
    expect(r).toBeGreaterThan(8);
  }, 300000);

  it("scales the lift with how much of the frame is lit — the whole point", async () => {
    const small = (await veil({ veil: { amount: 0.4 } }, 0.25))[0];
    const large = (await veil({ veil: { amount: 0.4 } }, 0.9))[0];
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small * 2);
  }, 300000);

  it("scales with amount at a fixed content level", async () => {
    const weak = (await veil({ veil: { amount: 0.1 } }, 0.5))[0];
    const strong = (await veil({ veil: { amount: 0.4 } }, 0.5))[0];
    expect(strong).toBeGreaterThan(weak);
  }, 300000);

  it("takes the colour of the light that caused it", async () => {
    const [r, g, b] = await veil({ veil: { amount: 0.4 } }, 0.5, "#ff2200");
    expect(r).toBeGreaterThan(g + 20);
    expect(r).toBeGreaterThan(b + 20);
  }, 300000);

  it("stays neutral under neutral light", async () => {
    const [r, g, b] = await veil({ veil: { amount: 0.4 } }, 0.5);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
  }, 300000);

  it("threshold holds the glare off until the frame is bright enough", async () => {
    // A quarter-width disc lights a few percent of the frame; the knee is set well above it.
    const gated = await veil({ veil: { amount: 0.4, threshold: 0.5 } }, 0.25);
    expect([gated[0], gated[1], gated[2]]).toEqual([0, 0, 0]);
    const open = await veil({ veil: { amount: 0.4, threshold: 0.5 } }, 1);
    expect(open[0]).toBeGreaterThan(0);
  }, 300000);

  it("lifts blacks far more than highlights — it is an ADD, not a wash", async () => {
    const base = await veil({}, 0.5);
    const lit = await veil({ veil: { amount: 0.4 } }, 0.5);
    const cornerLift = lit[0] - base[0];
    const discLift = lit[3] - base[3];
    expect(cornerLift).toBeGreaterThan(discLift + 8);
  }, 300000);
});

describe("veil: schema", () => {
  it("accepts the stage and bounds its params", () => {
    expect(validatePostFx({ veil: { amount: 0.05, threshold: 0.2 } })).toEqual([]);
    expect(validatePostFx({ veil: { amount: 2 } })).toEqual([
      "postFx.veil.amount must be between 0 and 1 (got 2)",
    ]);
    expect(validatePostFx({ veil: { strength: 1 } })[0]).toContain("is not a parameter");
  });

  it("is a legal adjustment-layer kind, so glare can read part of the stack", () => {
    expect(
      validateLayers([{ id: "glare", z: 705, adjust: [{ kind: "veil", params: { amount: 0.06 } }] }], 1),
    ).toEqual([]);
  });
});
