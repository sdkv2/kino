import { describe, it, expect, afterAll } from "vitest";
import { glProbe, closeGlHost } from "./helpers/glHost.js";

const ENTRY = "src/render/native/page/compositor/targets.ts";
const GLOBAL = "KinoTargets";
const HTML = `<!doctype html><body><canvas id="c" width="64" height="64"></canvas></body>`;

afterAll(closeGlHost);

describe("TargetPool", () => {
  it("reuses a released target instead of allocating a new one", async () => {
    const result = await glProbe<[], { reused: boolean; distinct: boolean; size: [number, number] }>({
      entry: ENTRY,
      globalName: GLOBAL,
      html: HTML,
      fn: () => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        const b = pool.acquire(gl, 64, 64);
        const c = pool.acquire(gl, 64, 64);
        return { reused: a.tex === b.tex, distinct: b.tex !== c.tex, size: [b.w, b.h] };
      },
    });
    expect(result.reused).toBe(true); // released target came back
    expect(result.distinct).toBe(true); // a second live target is its own allocation
    expect(result.size).toEqual([64, 64]);
  }, 120000);

  it("does not hand back a target of the wrong size", async () => {
    const reused = await glProbe<[], boolean>({
      entry: ENTRY,
      globalName: GLOBAL,
      html: HTML,
      fn: () => {
        const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
        const pool = new (window as any).KinoTargets.TargetPool();
        const a = pool.acquire(gl, 64, 64);
        pool.release(a);
        return pool.acquire(gl, 32, 32).tex === a.tex;
      },
    });
    expect(reused).toBe(false);
  }, 120000);
});
