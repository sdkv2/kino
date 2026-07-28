import { describe, it, expect } from "vitest";
import { capWorkers, bytesPerWorker } from "../src/render/native/workerCap.js";

const GB = 1024 ** 3;

describe("capWorkers", () => {
  it("passes the request through when VRAM is unknown", () => {
    expect(capWorkers(4, {})).toEqual({ workers: 4, reason: "requested" });
  });

  // 7,874,871,296 bytes free is what the measured RTX 3060 Ti actually reports at render time.
  it("caps by VRAM — the measured 8GB card at 1GB/worker fits 7", () => {
    expect(capWorkers(12, { vramFreeBytes: 7874871296, bytesPerWorker: GB })).toEqual({
      workers: 7,
      reason: "vram",
    });
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
  it("defaults to the 1GB figure calibrated on an RTX 3060 Ti", () => {
    expect(bytesPerWorker({})).toBe(GB);
  });

  it("honours KINO_VRAM_PER_WORKER in megabytes", () => {
    expect(bytesPerWorker({ KINO_VRAM_PER_WORKER: "2048" })).toBe(2048 * 1024 * 1024);
  });

  it("ignores junk rather than producing NaN", () => {
    expect(bytesPerWorker({ KINO_VRAM_PER_WORKER: "abc" })).toBe(GB);
  });
});
