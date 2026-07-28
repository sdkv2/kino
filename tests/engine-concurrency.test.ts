import { describe, it, expect } from "vitest";
import { concurrency } from "../src/render/native/engine.js";

// Worker count is bound by GPU memory, not CPU cores: at SS=2 every worker allocates its own
// 2160x3840 render target. One Electron host serves N offscreen windows, and measured throughput
// peaks at 4 — so the ceiling is flat across platforms rather than per-renderer.
describe("concurrency", () => {
  it("caps the default well below the core count on a big machine", () => {
    expect(concurrency(1000, {}, 28, "darwin")).toBe(4);
    expect(concurrency(1000, {}, 10, "darwin")).toBe(4);
  });

  it("uses the same ceiling on every platform", () => {
    expect(concurrency(1000, {}, 28, "linux")).toBe(4);
    expect(concurrency(1000, {}, 28, "win32")).toBe(4);
  });

  it("does not exceed cores-1 on small machines", () => {
    expect(concurrency(1000, {}, 2, "darwin")).toBe(1);
    expect(concurrency(1000, {}, 1, "darwin")).toBe(1);
    expect(concurrency(1000, {}, 3, "darwin")).toBe(2);
  });

  it("never spawns more workers than there are frames to render", () => {
    expect(concurrency(2, {}, 28, "darwin")).toBe(2);
    expect(concurrency(1, {}, 28, "darwin")).toBe(1);
  });

  it("honours an explicit KINO_CONCURRENCY override", () => {
    expect(concurrency(1000, { KINO_CONCURRENCY: "8" }, 10, "darwin")).toBe(8);
    expect(concurrency(1000, { KINO_CONCURRENCY: "1" }, 28, "darwin")).toBe(1);
  });

  it("ignores a junk or out-of-range override rather than spawning zero workers", () => {
    expect(concurrency(1000, { KINO_CONCURRENCY: "nonsense" }, 28, "darwin")).toBe(4);
    expect(concurrency(1000, { KINO_CONCURRENCY: "0" }, 28, "darwin")).toBe(4);
    expect(concurrency(1000, { KINO_CONCURRENCY: "-4" }, 28, "darwin")).toBe(4);
  });
});
