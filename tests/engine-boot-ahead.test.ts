import { describe, expect, it } from "vitest";
import { bootAheadEnabled } from "../src/render/native/engine.js";

describe("bootAheadEnabled", () => {
  it("is on where there are cores to absorb the page loads", () => {
    // Measured: 4090/61 cores, h=3 c=32 — 17.29s off vs 15.71s on.
    expect(bootAheadEnabled({}, 61)).toBe(true);
  });

  it("is off on a narrow box, where early page loads starve extraction", () => {
    // Measured: M4/10 cores at defaults — 17.24s off vs 20.19s on, a 17% regression.
    expect(bootAheadEnabled({}, 10)).toBe(false);
  });

  it("takes the env override either way, regardless of cores", () => {
    expect(bootAheadEnabled({ KINO_BOOT_AHEAD: "1" }, 4)).toBe(true);
    expect(bootAheadEnabled({ KINO_BOOT_AHEAD: "0" }, 128)).toBe(false);
  });

  it("reads the cgroup quota by default, not the host core count", () => {
    // usableCores() is the default arg; a container capped well under its host must not be treated
    // as wide. Asserting the boundary rather than the ambient machine keeps this host-independent.
    expect(bootAheadEnabled({}, 15)).toBe(false);
    expect(bootAheadEnabled({}, 16)).toBe(true);
  });
});
