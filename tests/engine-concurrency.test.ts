import { describe, it, expect } from "vitest";
import { concurrency } from "../src/render/native/engine.js";

// Worker count is bound by GPU memory, not CPU cores: at SS=2 every worker allocates its own
// 2160x3840 render target. Measured throughput peaks at 2 workers on M4 (showcase + bench4k).
describe("concurrency", () => {
  it("caps the default well below the core count on a big machine", () => {
    expect(concurrency(1000, {}, 28)).toBe(2);
    expect(concurrency(1000, {}, 10)).toBe(2);
  });

  it("does not exceed cores-1 on small machines", () => {
    expect(concurrency(1000, {}, 2)).toBe(1);
    expect(concurrency(1000, {}, 1)).toBe(1);
  });

  it("never spawns more workers than there are frames to render", () => {
    expect(concurrency(2, {}, 28)).toBe(2);
    expect(concurrency(1, {}, 28)).toBe(1);
  });

  it("honours an explicit KINO_CONCURRENCY override", () => {
    expect(concurrency(1000, { KINO_CONCURRENCY: "8" }, 10)).toBe(8);
    expect(concurrency(1000, { KINO_CONCURRENCY: "1" }, 28)).toBe(1);
  });

  it("ignores a junk or out-of-range override rather than spawning zero workers", () => {
    expect(concurrency(1000, { KINO_CONCURRENCY: "nonsense" }, 28)).toBe(2);
    expect(concurrency(1000, { KINO_CONCURRENCY: "0" }, 28)).toBe(2);
    expect(concurrency(1000, { KINO_CONCURRENCY: "-4" }, 28)).toBe(2);
  });
});
