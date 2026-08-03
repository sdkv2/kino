// The bloom ADD-BACK, which nothing covered.
//
// `probeEffect` runs a single pass with the default `axis`, so every bloom test ever written
// exercised the blur and never the composite step that adds the blurred light onto the original.
// That is how `postFx.bloom` came to be a no-op in real renders while its tests stayed green.
// This drives the real resolved chain (bright-pass → blur x → blur y → composite) through
// runPost, over a real pooled target.
import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";
import type { PostFx } from "../src/render/postSpec.js";

afterAll(closeGlHost);

async function probePost(postFx: PostFx, offsets: number[], churn = 0): Promise<number[]> {
  return glProbe<[PostFx, number[], number], number[]>({
    entry: "src/render/native/page/compositor/effects/index.ts",
    globalName: "KinoFx",
    html: `<!doctype html><body><canvas id="c" width="128" height="128"></canvas></body>`,
    fn: (postFx, offsets, churn) =>
      (window as any).KinoFx.probePostChain(document.getElementById("c") as HTMLCanvasElement, postFx, offsets, churn),
    args: [postFx, offsets, churn],
  });
}

describe("postFx.bloom composite", () => {
  it("adds light OUTSIDE the source disc — the whole point of a bloom", async () => {
    // The disc has radius 8 on a 128px canvas. At +12 and +16 the source is pure black, so any
    // value above zero can only have come from the add-back.
    const [onDisc, near, far] = await probePost(
      { bloom: { threshold: 0, intensity: 3, radius: 40 } },
      [0, 12, 16],
    );
    expect(onDisc).toBeGreaterThan(200);
    expect(near).toBeGreaterThan(8);
    expect(far).toBeGreaterThan(2);
  }, 300000);

  it("is dark outside the disc with no bloom at all — the control", async () => {
    const [onDisc, near] = await probePost({}, [0, 12]);
    expect(onDisc).toBeGreaterThan(200);
    expect(near).toBeLessThan(3);
  }, 300000);

  it("still blooms when the pool has been churned by a layer walk", async () => {
    // A real render acquires and releases many targets before post runs, so `composite` and every
    // chain target come out of the free list. This is the state the isolated probe never had.
    const [onDisc, near] = await probePost({ bloom: { threshold: 0, intensity: 3, radius: 40 } }, [0, 12], 4);
    expect(onDisc).toBeGreaterThan(200);
    expect(near).toBeGreaterThan(8);
  }, 300000);

  it("scales with intensity", async () => {
    const [lo] = await probePost({ bloom: { threshold: 0, intensity: 1, radius: 40 } }, [12]);
    const [hi] = await probePost({ bloom: { threshold: 0, intensity: 6, radius: 40 } }, [12]);
    expect(hi).toBeGreaterThan(lo);
  }, 300000);
});
