// Exact signed distance fields for segmentation masks.
//
// WHY THIS EXISTS. `kinoMaskDist` (shaderSource.ts) answers "how far is this pixel from the mask
// boundary" at render time, from the mask texture alone. Inside the mask's own transition band it
// reads sub-pixel distance from screen-space derivatives — exact and free. Beyond that band the
// coverage saturates, the gradient collapses, and it falls back to a 24-tap golden-angle spiral
// that BREAKS AT THE FIRST CROSSING. That fallback is quantised in radius (radius/24 steps) and
// sparse in angle, so the answer depends on which way the boundary happens to lie: the field comes
// out as hard faceted plateaus, which is visible as banding in any effect with real reach (a wide
// rim, an inward glow, a deep erode).
//
// No tap budget fixes that. Finding the true nearest boundary point within radius R by point
// sampling is O(R²) — at R=70 that is thousands of taps, not 24. But the answer is a pure function
// of the mask, and the mask is a FILE. So compute it once, offline, exactly.
//
// This module is the pure core: an exact Euclidean distance transform (Felzenszwalb &
// Huttenlocher's O(n) separable algorithm — the same one used for real SDF generation, not an
// approximation), plus the 8-bit packing that gets it to the GPU. Everything here is deterministic
// and free of I/O so it can be unit-tested against analytic distances.
//
// Encoding: one object per RGBA channel, `d` mapped from [-maxDist, +maxDist] onto 0..255, with
// `maxDist` fitted per mask and carried to the shader as a uniform. Four objects fill RGBA exactly,
// which is the same budget the packed mask itself uses.

/** Encode half-range in pixels: the field saturates here, and 8 bits over ±128 gives ~1px steps.
 *  Fixed rather than fitted per mask because the encode range has to be constant across a beat (it
 *  reaches the shader as one uniform), so fitting would need a full measuring pass before any frame
 *  could be written — to buy precision below what any effect resolves. Lives here, not in
 *  sdfFrames.ts, because the render page imports it and that module pulls in node:child_process. */
export const SDF_MAX_PX = 128;

/** Squared 1-D EDT of `f` (Felzenszwalb & Huttenlocher). Writes into `d`; `v`/`z` are scratch. */
function edt1d(f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    // Intersection of the parabola at q with the one currently on top of the lower envelope.
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dq = q - v[k];
    d[q] = dq * dq + f[v[k]];
  }
}

const INF = 1e20;

/** Squared EDT of a 2-D indicator: 0 where `seed` is set, distance² to the nearest set pixel else. */
function edt2d(seed: Uint8Array, w: number, h: number): Float64Array {
  const f = new Float64Array(Math.max(w, h));
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h) + 1);
  const z = new Float64Array(Math.max(w, h) + 1);
  const grid = new Float64Array(w * h);

  for (let i = 0; i < grid.length; i++) grid[i] = seed[i] ? 0 : INF;

  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
    edt1d(f, d, v, z, h);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) f[x] = grid[row + x];
    edt1d(f, d, v, z, w);
    for (let x = 0; x < w; x++) grid[row + x] = d[x];
  }
  return grid;
}

/** Signed distance in PIXELS to the mask boundary: negative inside, positive outside.
 *
 *  `coverage` is one channel of the mask, 0..1; >= 0.5 counts as inside, the same threshold the
 *  region split itself uses. Two transforms are needed — distance-to-inside for outside pixels and
 *  distance-to-outside for inside ones — and the half-texel offset puts the zero crossing on the
 *  boundary BETWEEN pixels rather than on the last pixel of either side, matching what the
 *  derivative branch of kinoMaskDist reports where the two overlap.
 *
 *  A field with no boundary at all (all inside / all outside) has no zero crossing; it resolves to
 *  a large magnitude of the correct sign rather than 0, so a degenerate mask can never read as
 *  "everything is exactly on the edge". */
export function signedDistance(coverage: Float32Array | Uint8Array, w: number, h: number): Float32Array {
  const n = w * h;
  const inside = new Uint8Array(n);
  const outside = new Uint8Array(n);
  const scale = coverage instanceof Uint8Array ? 1 / 255 : 1;
  let anyIn = false;
  let anyOut = false;
  for (let i = 0; i < n; i++) {
    const on = coverage[i] * scale >= 0.5;
    inside[i] = on ? 1 : 0;
    outside[i] = on ? 0 : 1;
    if (on) anyIn = true;
    else anyOut = true;
  }

  const out = new Float32Array(n);
  const far = Math.hypot(w, h);
  if (!anyIn) {
    out.fill(far);
    return out;
  }
  if (!anyOut) {
    out.fill(-far);
    return out;
  }

  const dOut = edt2d(inside, w, h); // for pixels outside: distance² to the nearest inside pixel
  const dIn = edt2d(outside, w, h); // for pixels inside: distance² to the nearest outside pixel
  for (let i = 0; i < n; i++) {
    out[i] = inside[i] ? -(Math.sqrt(dIn[i]) - 0.5) : Math.sqrt(dOut[i]) - 0.5;
  }
  return out;
}

/** Smallest encode range that covers every field's peak magnitude, so the 8-bit step stays as fine
 *  as the content allows. Fitting per mask matters: a mask whose deepest interior is 180px would
 *  otherwise waste half the code range on distances that never occur. Never 0. */
export function fitMaxDist(fields: Float32Array[]): number {
  let peak = 0;
  for (const f of fields) for (let i = 0; i < f.length; i++) peak = Math.max(peak, Math.abs(f[i]));
  return Math.max(1, Math.ceil(peak));
}

/** Pack up to four signed fields into RGBA8. Channel i holds object i, mapped
 *  [-maxDist, +maxDist] → 0..255. A null/absent entry leaves that channel at +maxDist (fully
 *  OUTSIDE), so an unbound object can never read as inside — the same safety the zero uChannel
 *  vector gives the mask. Sparse entries are allowed so a beat reading only channels 0 and 2 does
 *  not have to compute a field for 1. */
export function encodeSdfRGBA(
  fields: readonly (Float32Array | null | undefined)[],
  w: number,
  h: number,
  maxDist: number,
): Uint8Array {
  const n = w * h;
  const rgba = new Uint8Array(n * 4);
  rgba.fill(255); // default every channel to +maxDist
  for (let c = 0; c < Math.min(4, fields.length); c++) {
    const f = fields[c];
    if (!f) continue;
    for (let i = 0; i < n; i++) {
      const t = (f[i] / maxDist) * 0.5 + 0.5;
      rgba[i * 4 + c] = Math.max(0, Math.min(255, Math.round(t * 255)));
    }
  }
  return rgba;
}

/** Inverse of one encoded byte — the decode the shader performs, kept here so tests pin both ends. */
export function decodeSdfSample(byte: number, maxDist: number): number {
  return ((byte / 255) * 2 - 1) * maxDist;
}
