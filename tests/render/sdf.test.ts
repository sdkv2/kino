import { describe, it, expect } from "vitest";
import { signedDistance, fitMaxDist, encodeSdfRGBA, decodeSdfSample } from "../../src/render/sdf.js";

// Coverage helper: build a WxH field from a predicate, 0..1 like a mask channel.
function field(w: number, h: number, inside: (x: number, y: number) => boolean): Float32Array {
  const f = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[y * w + x] = inside(x, y) ? 1 : 0;
  return f;
}

const at = (d: Float32Array, w: number, x: number, y: number) => d[y * w + x];

describe("signedDistance", () => {
  it("is negative inside, positive outside, ~0 on the boundary", () => {
    const w = 64, h = 64;
    // Rectangle x in [16,47], y in [16,47].
    const d = signedDistance(field(w, h, (x, y) => x >= 16 && x <= 47 && y >= 16 && y <= 47), w, h);
    expect(at(d, w, 32, 32)).toBeLessThan(0); // deep inside
    expect(at(d, w, 2, 2)).toBeGreaterThan(0); // far outside
    expect(Math.abs(at(d, w, 16, 32))).toBeLessThanOrEqual(1); // on the left edge
  });

  it("matches the analytic distance to a straight edge, well beyond any tap-search radius", () => {
    const w = 256, h = 8;
    // Half-plane: inside where x >= 128, so the boundary sits between pixels 127 and 128 at x=127.5.
    // Negative inside, positive outside.
    const d = signedDistance(field(w, h, (x) => x >= 128), w, h);
    for (const x of [8, 40, 96, 127, 128, 160, 200, 247]) {
      const expected = x >= 128 ? -(x - 127.5) : 127.5 - x;
      expect(at(d, w, x, 4)).toBeCloseTo(expected, 5);
    }
  });

  it("is exact at radii where the 24-tap spiral fallback degrades (>100px)", () => {
    const w = 512, h = 512;
    const cx = 256, cy = 256, r = 160;
    const d = signedDistance(field(w, h, (x, y) => Math.hypot(x - cx, y - cy) <= r), w, h);
    // 150px inside the silhouette along an axis the spiral would never sample cleanly.
    const probe = at(d, w, cx, cy - 10); // ~150px from the top of the disc
    expect(probe).toBeLessThan(-140);
    expect(probe).toBeGreaterThan(-160);
  });

  it("treats an all-inside field as fully inside (no boundary to find)", () => {
    const w = 16, h = 16;
    const d = signedDistance(field(w, h, () => true), w, h);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeLessThan(0);
  });

  it("treats an all-outside field as fully outside", () => {
    const w = 16, h = 16;
    const d = signedDistance(field(w, h, () => false), w, h);
    for (let i = 0; i < d.length; i++) expect(d[i]).toBeGreaterThan(0);
  });
});

describe("fitMaxDist", () => {
  it("covers the largest magnitude present, rounded up", () => {
    const w = 128, h = 128;
    const d = signedDistance(field(w, h, (x, y) => x >= 32 && x < 96 && y >= 32 && y < 96), w, h);
    const m = fitMaxDist([d]);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    expect(m).toBeGreaterThanOrEqual(peak);
  });

  it("never returns 0 — a degenerate mask must not make the decode divide by nothing", () => {
    expect(fitMaxDist([new Float32Array(4)])).toBeGreaterThan(0);
  });
});

describe("encodeSdfRGBA / decodeSdfSample", () => {
  it("round-trips a distance to within one quantisation step", () => {
    const w = 64, h = 64;
    const d = signedDistance(field(w, h, (x, y) => x >= 16 && x < 48 && y >= 16 && y < 48), w, h);
    const maxDist = fitMaxDist([d]);
    const rgba = encodeSdfRGBA([d], w, h, maxDist);
    expect(rgba.length).toBe(w * h * 4);

    const step = (2 * maxDist) / 255;
    for (const [x, y] of [[32, 32], [16, 20], [2, 2], [63, 63]] as const) {
      const got = decodeSdfSample(rgba[(y * w + x) * 4], maxDist);
      expect(Math.abs(got - at(d, w, x, y))).toBeLessThanOrEqual(step);
    }
  });

  it("packs up to four objects into R/G/B/A independently", () => {
    const w = 32, h = 32;
    const left = signedDistance(field(w, h, (x) => x < 8), w, h);
    const right = signedDistance(field(w, h, (x) => x >= 24), w, h);
    const maxDist = fitMaxDist([left, right]);
    const rgba = encodeSdfRGBA([left, right], w, h, maxDist);

    const i = (4 * w + 4) * 4; // a pixel inside `left`, outside `right`
    expect(decodeSdfSample(rgba[i], maxDist)).toBeLessThan(0);
    expect(decodeSdfSample(rgba[i + 1], maxDist)).toBeGreaterThan(0);
    // Unused channels encode +maxDist (fully outside) so an unbound object never reads as inside.
    expect(decodeSdfSample(rgba[i + 2], maxDist)).toBeGreaterThan(0);
    expect(decodeSdfSample(rgba[i + 3], maxDist)).toBeGreaterThan(0);
  });
});

describe("encodeSdfRGBA sparse channels", () => {
  it("skips a null entry, leaving that channel fully outside", () => {
    const w = 16, h = 16;
    const f = signedDistance(new Float32Array(w * h).fill(1), w, h); // all inside
    const rgba = encodeSdfRGBA([f, null, f, undefined], w, h, 64);
    const i = (8 * w + 8) * 4;
    expect(decodeSdfSample(rgba[i], 64)).toBeLessThan(0); // ch0 provided → inside
    expect(decodeSdfSample(rgba[i + 1], 64)).toBeGreaterThan(0); // ch1 null → outside
    expect(decodeSdfSample(rgba[i + 2], 64)).toBeLessThan(0); // ch2 provided → inside
    expect(decodeSdfSample(rgba[i + 3], 64)).toBeGreaterThan(0); // ch3 absent → outside
  });
});
