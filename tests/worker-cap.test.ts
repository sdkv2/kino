import { describe, it, expect } from "vitest";
import { capWorkers, bytesPerWorker } from "../src/render/native/workerCap.js";

const GB = 1024 ** 3;
const MB = 1024 * 1024;
/** Free VRAM the calibration RTX 3060 Ti (8GB) actually reports at render time. */
const MEASURED_3060TI_FREE = 7874871296;

describe("capWorkers", () => {
  it("passes the request through when VRAM is unknown", () => {
    expect(capWorkers(4, {})).toEqual({ workers: 4, reason: "requested" });
  });

  // 7,874,871,296 bytes free is what the measured RTX 3060 Ti actually reports at render time —
  // ~7510MB, not the nominal 8192MB.
  it("caps by VRAM — the measured 8GB card at 1GB/worker fits 7", () => {
    expect(capWorkers(12, { vramFreeBytes: MEASURED_3060TI_FREE, bytesPerWorker: GB })).toEqual({
      workers: 7,
      reason: "vram",
    });
  });

  // Regression: at 1GB/worker this floored to 7 and refused c=8, the measured throughput optimum
  // on this exact card (160.9 fps at c=7 vs 208.2 at c=8). The shipped default must reach 8.
  it("caps by VRAM — the shipped default lets the measured 8GB card reach its c=8 optimum", () => {
    expect(
      capWorkers(12, { vramFreeBytes: MEASURED_3060TI_FREE, bytesPerWorker: bytesPerWorker({}) }),
    ).toEqual({ workers: 8, reason: "vram" });
  });

  // ...and does not overshoot into 9, which the marginal-cost measurements do not support.
  it("does not let the default overshoot past 8 on that card", () => {
    const { workers } = capWorkers(16, {
      vramFreeBytes: MEASURED_3060TI_FREE,
      bytesPerWorker: bytesPerWorker({}),
    });
    expect(workers).toBeLessThanOrEqual(8);
  });

  it("does not raise a request that is already under the cap", () => {
    expect(capWorkers(2, { vramFreeBytes: 24 * GB, bytesPerWorker: GB })).toEqual({
      workers: 2,
      reason: "requested",
    });
  });

  it("caps by NVENC session limit when that binds first", () => {
    expect(capWorkers(6, { vramFreeBytes: 24 * GB, bytesPerWorker: GB, sessionLimit: 3 })).toEqual({
      workers: 3,
      reason: "sessions",
    });
  });

  it("never returns zero workers on a tiny card", () => {
    expect(capWorkers(4, { vramFreeBytes: 512 * 1024 * 1024, bytesPerWorker: GB }).workers).toBe(1);
  });
});

describe("bytesPerWorker", () => {
  it("defaults to the 900MB figure calibrated on an RTX 3060 Ti", () => {
    expect(bytesPerWorker({})).toBe(900 * MB);
  });

  it("honours KINO_VRAM_PER_WORKER in megabytes", () => {
    expect(bytesPerWorker({ KINO_VRAM_PER_WORKER: "2048" })).toBe(2048 * 1024 * 1024);
  });

  it("ignores junk rather than producing NaN", () => {
    expect(bytesPerWorker({ KINO_VRAM_PER_WORKER: "abc" })).toBe(900 * MB);
  });
});
