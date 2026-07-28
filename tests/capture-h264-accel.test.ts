import { afterEach, describe, expect, it } from "vitest";
import { resolveH264Accel } from "../src/render/native/page/captureH264.js";

// resolveH264Accel drives which `hardwareAcceleration` hint the encoder configures with — the
// probe/encoder disagreement fixed for Linux, and the accelCache correctness fixed alongside it.
// Neither is reachable from a real VideoEncoder in this suite (no Chromium here), so fake the one
// surface the function actually calls: VideoEncoder.isConfigSupported.
type Cfg = { hardwareAcceleration?: "prefer-hardware" };

function installFakeVideoEncoder(supported: (cfg: Cfg) => boolean): { calls: Cfg[] } {
  const calls: Cfg[] = [];
  (globalThis as { VideoEncoder?: unknown }).VideoEncoder = {
    isConfigSupported: async (cfg: Cfg) => {
      calls.push(cfg);
      return { supported: supported(cfg) };
    },
  };
  return { calls };
}

const realVideoEncoder = (globalThis as { VideoEncoder?: unknown }).VideoEncoder;

afterEach(() => {
  (globalThis as { VideoEncoder?: unknown }).VideoEncoder = realVideoEncoder;
});

// Each case uses its own width/height so the module-level accelCache/hwRefused (there is no
// exported reset) can't leak state between cases.
let nextW = 1000;
function size(): [number, number, number] {
  nextW += 1;
  return [nextW, 480, 30];
}

describe("resolveH264Accel", () => {
  it("returns null when VideoEncoder is unavailable in this Chromium", async () => {
    delete (globalThis as { VideoEncoder?: unknown }).VideoEncoder;
    expect(await resolveH264Accel(...size())).toBeNull();
  });

  it("probes hardware first and returns it when supported", async () => {
    const fake = installFakeVideoEncoder((cfg) => cfg.hardwareAcceleration === "prefer-hardware");
    expect(await resolveH264Accel(...size())).toBe("prefer-hardware");
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].hardwareAcceleration).toBe("prefer-hardware");
  });

  it("falls back to letting Chromium choose when the hardware config is unsupported", async () => {
    const fake = installFakeVideoEncoder((cfg) => cfg.hardwareAcceleration === undefined);
    expect(await resolveH264Accel(...size())).toBeUndefined();
    // Hardware probed first, then the no-hint fallback — never the reverse.
    expect(fake.calls.map((c) => c.hardwareAcceleration)).toEqual(["prefer-hardware", undefined]);
  });

  it("returns null when neither hardware nor the fallback config is supported", async () => {
    installFakeVideoEncoder(() => false);
    expect(await resolveH264Accel(...size())).toBeNull();
  });

  it("caches the resolved software hint (undefined) and does not re-probe on the next call", async () => {
    // This is the exact case finding 1 was about: `Map.get` cannot tell a stored `undefined`
    // apart from a miss, so the old code re-resolved (and re-called isConfigSupported twice) on
    // every single call on a box with no Chromium-visible hardware encoder.
    const fake = installFakeVideoEncoder((cfg) => cfg.hardwareAcceleration === undefined);
    const dims = size();
    expect(await resolveH264Accel(...dims)).toBeUndefined();
    const callsAfterFirstResolve = fake.calls.length;
    expect(await resolveH264Accel(...dims)).toBeUndefined();
    expect(fake.calls.length).toBe(callsAfterFirstResolve);
  });

  it("caches a resolved hardware hint too, and does not re-probe on the next call", async () => {
    const fake = installFakeVideoEncoder(() => true);
    const dims = size();
    expect(await resolveH264Accel(...dims)).toBe("prefer-hardware");
    const callsAfterFirstResolve = fake.calls.length;
    expect(await resolveH264Accel(...dims)).toBe("prefer-hardware");
    expect(fake.calls.length).toBe(callsAfterFirstResolve);
  });

  it("caches the unsupported (null) result too", async () => {
    const fake = installFakeVideoEncoder(() => false);
    const dims = size();
    expect(await resolveH264Accel(...dims)).toBeNull();
    const callsAfterFirstResolve = fake.calls.length;
    expect(await resolveH264Accel(...dims)).toBeNull();
    expect(fake.calls.length).toBe(callsAfterFirstResolve);
  });
});
