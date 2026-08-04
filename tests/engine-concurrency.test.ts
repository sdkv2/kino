import { describe, it, expect } from "vitest";
import { concurrency, electronHosts } from "../src/render/native/engine.js";

// Worker count is bound by GPU throughput and memory, not CPU cores: at SS=2 every worker allocates
// its own 2160x3840 render target. Within ONE Electron host, measured throughput peaks at 4 — the
// contended resource is that host's single Chromium GPU process.
//
// The peak-at-4 claim was re-measured 2026-07-28 (c=2 ~1.6x slower; c=6 indistinguishable but +28%
// RAM) after the motion-path perf work, and 6 was tried and reverted. It still holds per host. What
// changed is that a render can now use several hosts, each with its own GPU process, so the total
// worker count is no longer capped at one host's worth. See electronHosts in engine.ts.
describe("concurrency", () => {
  it("caps a single host's workers at 4 regardless of cores", () => {
    // Under the shard threshold, so these stay one host and land on the old ceiling exactly.
    expect(concurrency(500, {}, 28, "darwin")).toBe(4);
    expect(concurrency(500, {}, 10, "darwin")).toBe(4);
    expect(concurrency(500, {}, 128, "darwin")).toBe(4);
  });

  it("uses the same ceiling on every platform", () => {
    expect(concurrency(500, {}, 28, "linux")).toBe(4);
    expect(concurrency(500, {}, 28, "win32")).toBe(4);
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

  it("scales past one host's ceiling on a long render and a big machine", () => {
    // 28 cores -> 4 hosts by the ~7-cores-per-host fit, 4 slots each.
    expect(concurrency(2000, {}, 28, "darwin")).toBe(16);
    // 61 cores -> 8 hosts (MAX_HOSTS), the measured 4090 optimum.
    expect(concurrency(4000, {}, 61, "darwin")).toBe(32);
  });

  it("honours an explicit KINO_CONCURRENCY override", () => {
    expect(concurrency(1000, { KINO_CONCURRENCY: "8" }, 10, "darwin")).toBe(8);
    expect(concurrency(1000, { KINO_CONCURRENCY: "1" }, 28, "darwin")).toBe(1);
  });

  it("ignores a junk or out-of-range override rather than spawning zero workers", () => {
    expect(concurrency(500, { KINO_CONCURRENCY: "nonsense" }, 28, "darwin")).toBe(4);
    expect(concurrency(500, { KINO_CONCURRENCY: "0" }, 28, "darwin")).toBe(4);
    expect(concurrency(500, { KINO_CONCURRENCY: "-4" }, 28, "darwin")).toBe(4);
  });
});

// Each host is a separate Electron app with its own GPU process — that is the whole point, and also
// the whole cost: ~2-5s of boot each. The rules below all exist to keep that cost earned.
describe("electronHosts", () => {
  it("stays single-host for short renders, where boot cost exceeds the saving", () => {
    // 354 frames is the glass-morph bench spec: ~3s of rendering, less than the boot it would buy.
    expect(electronHosts(354, {}, 61)).toBe(1);
    expect(electronHosts(599, {}, 61)).toBe(1);
  });

  it("reproduces both measured optima from the core count", () => {
    // Fitted, not guessed: these two are the configurations actually benchmarked.
    expect(electronHosts(4000, {}, 23)).toBe(3); // RTX 3060 Ti container -> 246 fps
    expect(electronHosts(4000, {}, 61)).toBe(8); // RTX 4090 -> 578 fps
  });

  it("never spawns a host that cannot amortise its own boot", () => {
    // 700 frames over 8 hosts would be ~90 frames each, under a second of work per host.
    expect(electronHosts(700, {}, 61)).toBe(2);
    expect(electronHosts(1817, {}, 61)).toBe(6); // a 60s 1080p footage bench
  });

  it("caps the process count on very large machines", () => {
    expect(electronHosts(100_000, {}, 256)).toBe(8);
  });

  it("stays single-host on ordinary laptops", () => {
    expect(electronHosts(4000, {}, 10)).toBe(1);
    expect(electronHosts(4000, {}, 8)).toBe(1);
  });

  // The render path clamps hosts to ceil(workers / 4) so a host always gets a full set of windows.
  // Without that, `KINO_CONCURRENCY=4` on a long render would spread 4 workers over 3 hosts — and
  // scripts/shard-render, which pins KINO_CONCURRENCY=4 per build, would multiply hosts by builds
  // (3 builds x 3 hosts = 9 Electron processes on a 23-core box).
  it("pairs with the render path's clamp so a small explicit worker count stays on one host", () => {
    const hosts = electronHosts(4000, {}, 23);
    expect(hosts).toBe(3);
    const clamp = (workers: number) => Math.max(1, Math.min(hosts, Math.ceil(workers / 4)));
    expect(clamp(4)).toBe(1);
    expect(clamp(8)).toBe(2);
    expect(clamp(12)).toBe(3);
    expect(clamp(1)).toBe(1);
  });

  it("honours an explicit KINO_ELECTRON_HOSTS override, including for short renders", () => {
    expect(electronHosts(100, { KINO_ELECTRON_HOSTS: "4" }, 10)).toBe(4);
    expect(electronHosts(4000, { KINO_ELECTRON_HOSTS: "1" }, 61)).toBe(1);
  });

  it("ignores junk overrides rather than spawning zero hosts", () => {
    expect(electronHosts(500, { KINO_ELECTRON_HOSTS: "nonsense" }, 61)).toBe(1);
    expect(electronHosts(4000, { KINO_ELECTRON_HOSTS: "0" }, 61)).toBe(8);
  });
});
