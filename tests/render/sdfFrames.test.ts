import { describe, it, expect } from "vitest";
import { channelIndices, sdfFrameRGBA, sdfDims, SDF_SCALE } from "../../src/render/native/sdfFrames.js";
import { decodeSdfSample, SDF_MAX_PX } from "../../src/render/sdf.js";

/** An RGBA mask frame with a filled disc on the given channel. */
function maskFrame(w: number, h: number, chan: number, cx: number, cy: number, r: number): Uint8Array {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.hypot(x - cx, y - cy) <= r) rgba[(y * w + x) * 4 + chan] = 255;
    }
  }
  return rgba;
}

describe("channelIndices", () => {
  it("maps manifest channels to RGBA indices and dedupes", () => {
    expect(channelIndices(["r"])).toEqual([0]);
    expect(channelIndices(["gray"])).toEqual([0]); // gray masks carry coverage in r
    expect(channelIndices(["b", "g"])).toEqual([1, 2]);
    expect(channelIndices(["r", "r", "a"])).toEqual([0, 3]);
  });
});

describe("sdfFrameRGBA", () => {
  const w = 128, h = 128, cx = 64, cy = 64, r = 40;
  const rw = sdfDims(w, h).width;
  // The field is STORED reduced, but its values are full-resolution pixels — so a caller indexes
  // at reduced coords and reads a distance in source px. Tolerance is one reduced texel.
  const tol = SDF_SCALE + 1;

  it("is stored at reduced resolution", () => {
    const out = sdfFrameRGBA(maskFrame(w, h, 0, cx, cy, r), w, h, [0]);
    expect(out.length).toBe(sdfDims(w, h).width * sdfDims(w, h).height * 4);
    expect(out.length).toBeLessThan(w * h * 4);
  });

  it("writes a field whose decoded distance matches the geometry", () => {
    const out = sdfFrameRGBA(maskFrame(w, h, 0, cx, cy, r), w, h, [0]);
    // Full-res coords → reduced index; the decoded value stays in full-res px.
    const at = (x: number, y: number) =>
      decodeSdfSample(out[(Math.floor(y / SDF_SCALE) * rw + Math.floor(x / SDF_SCALE)) * 4], SDF_MAX_PX);

    expect(at(cx, cy)).toBeLessThan(-r + tol); // centre is ~r inside
    expect(at(cx, cy)).toBeGreaterThan(-r - tol);
    expect(Math.abs(at(cx + r, cy))).toBeLessThanOrEqual(tol); // on the rim
    expect(at(2, 2)).toBeGreaterThan(0); // corner is outside
  });

  it("only computes the channels asked for — others read fully outside", () => {
    // Discs on BOTH r and g, but only channel 0 requested.
    const frame = maskFrame(w, h, 0, cx, cy, r);
    const g = maskFrame(w, h, 1, cx, cy, r);
    for (let i = 0; i < frame.length; i++) frame[i] |= g[i];

    const out = sdfFrameRGBA(frame, w, h, [0]);
    const i = (Math.floor(cy / SDF_SCALE) * rw + Math.floor(cx / SDF_SCALE)) * 4;
    expect(decodeSdfSample(out[i], SDF_MAX_PX)).toBeLessThan(0); // requested → real field
    expect(decodeSdfSample(out[i + 1], SDF_MAX_PX)).toBeGreaterThan(0); // skipped → outside
  });

  it("keeps two objects independent when both channels are requested", () => {
    const a = maskFrame(w, h, 0, 32, 64, 20);
    const b = maskFrame(w, h, 1, 96, 64, 20);
    for (let i = 0; i < a.length; i++) a[i] |= b[i];

    const out = sdfFrameRGBA(a, w, h, [0, 1]);
    const left = (Math.floor(64 / SDF_SCALE) * rw + Math.floor(32 / SDF_SCALE)) * 4;
    const right = (Math.floor(64 / SDF_SCALE) * rw + Math.floor(96 / SDF_SCALE)) * 4;
    expect(decodeSdfSample(out[left], SDF_MAX_PX)).toBeLessThan(0); // inside object 0
    expect(decodeSdfSample(out[left + 1], SDF_MAX_PX)).toBeGreaterThan(0); // outside object 1
    expect(decodeSdfSample(out[right], SDF_MAX_PX)).toBeGreaterThan(0);
    expect(decodeSdfSample(out[right + 1], SDF_MAX_PX)).toBeLessThan(0);
  });

  it("resolves distances far beyond the in-shader search's accurate band", () => {
    // The whole point of the field: at 100px inside a shape, the 24-tap spiral fallback is a
    // faceted step function. This must be smooth and monotonic instead.
    const big = 400;
    const bw = sdfDims(big, big).width;
    const out = sdfFrameRGBA(maskFrame(big, big, 0, 200, 200, 150), big, big, [0]);
    const d = (x: number) =>
      decodeSdfSample(out[(Math.floor(200 / SDF_SCALE) * bw + Math.floor(x / SDF_SCALE)) * 4], SDF_MAX_PX);
    // Walking inward from the rim, distance must decrease monotonically, no plateaus wider than
    // the 1px quantisation step.
    let prev = d(51); // just inside the left rim
    for (let x = 55; x <= 195; x += 5) {
      const cur = d(x);
      expect(cur).toBeLessThanOrEqual(prev + 1e-3);
      prev = cur;
    }
    // The centre is ~150px in, but the encode range is fixed: the field SATURATES at -SDF_MAX_PX
    // rather than reporting the true depth. Everything past that reads the same, which is fine
    // because kinoMaskDist clamps to the caller's `radius` anyway — and radius that deep was never
    // usable before. Pinned so a future change to SDF_MAX_PX is a deliberate one.
    expect(d(200)).toBeCloseTo(-SDF_MAX_PX, 0);
  });
});
