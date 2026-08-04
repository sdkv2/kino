import { describe, it, expect } from "vitest";
import { placeWorker } from "../src/render/native/electron/slots.js";

// A render's workers are numbered globally, but each Electron host numbers its own windows from 0.
// Getting this mapping wrong is silent rather than loud: two workers landing on the same
// (host, slot) would seek the same window from two async loops and interleave their frames.
describe("placeWorker", () => {
  it("keeps every worker on its own window", () => {
    for (const hostCount of [1, 2, 3, 4, 8]) {
      const seen = new Set<string>();
      for (let i = 0; i < 32; i++) {
        const { hostIdx, slot } = placeWorker(i, hostCount);
        const key = `${hostIdx}:${slot}`;
        expect(seen.has(key), `duplicate placement ${key} at worker ${i}, hosts=${hostCount}`).toBe(false);
        seen.add(key);
        expect(hostIdx).toBeLessThan(hostCount);
      }
    }
  });

  it("is identity-shaped for a single host, matching pre-sharding behaviour", () => {
    for (let i = 0; i < 8; i++) {
      expect(placeWorker(i, 1)).toEqual({ hostIdx: 0, slot: i });
    }
  });

  it("round-robins so a partial worker set still spreads across hosts", () => {
    // Blocked assignment would put workers 0 and 1 both on host 0; round-robin gives each a host,
    // which matters because acquisition is concurrent and can complete out of order.
    expect(placeWorker(0, 2)).toEqual({ hostIdx: 0, slot: 0 });
    expect(placeWorker(1, 2)).toEqual({ hostIdx: 1, slot: 0 });
    expect(placeWorker(2, 2)).toEqual({ hostIdx: 0, slot: 1 });
    expect(placeWorker(3, 2)).toEqual({ hostIdx: 1, slot: 1 });
  });

  it("balances hosts to within one slot", () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 17; i++) {
      const { hostIdx } = placeWorker(i, 4);
      counts.set(hostIdx, (counts.get(hostIdx) ?? 0) + 1);
    }
    const loads = [...counts.values()];
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(1);
  });

  it("treats a zero or negative host count as one host rather than dividing by it", () => {
    expect(placeWorker(3, 0)).toEqual({ hostIdx: 0, slot: 3 });
    expect(placeWorker(3, -2)).toEqual({ hostIdx: 0, slot: 3 });
  });
});
