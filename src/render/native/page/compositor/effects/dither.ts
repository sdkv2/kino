// Output dither: an ordered (Bayer-8) quantization-noise stage for near-black gradients.
//
// The compositor rasterizes at 8 bits per channel, so a smooth near-black gradient quantizes to
// 30–48px plateaus (measured: 22 distinct values over 1920 rows on #000 → #0a0a10 → #000). An
// ordered dither is the standard fix: add a deterministic per-pixel offset of ±0.5 LSB so the
// quantizer lands on different levels per pixel, and the plateau edges dissolve into noise that
// the eye integrates back into a ramp.
//
// Determinism is the contract. The offset depends ONLY on gl_FragCoord (pixel position) — never
// uFrame, never a hash, never anything random — so the same frame rendered twice is byte-identical
// (compositor self-determinism test) and the frame cache stays sound. A random/uniform dither
// would be temporally noisy AND break both.
//
// It runs at the END of the tail post chain (after lens — see postChainOrder), i.e. after the
// resolve to output resolution, which is exactly where banding becomes visible. It is opt-in via
// `postFx.dither` (strength 0..1, default 0.5 when the stage is present) so no existing spec's
// pixels move: the byte-stability doctrine — "existing specs must not move" — applies to pixels
// too, and a dither is the kind of change that would silently alter every shipped frame.
//
// Amplitude: strength maps 0..1 → 0..1/255 (a full LSB at full strength). Ordered dithering
// needs a peak offset of one quantization step to fully break a plateau; the 0.5 default is
// half that — conservative enough to be invisible on flat midtones, strong enough to visibly
// de-band near-black ramps.
import { numParam, type EffectPass } from "./pass.js";
import { runChain } from "./chain.js";
import { TargetPool } from "../targets.js";

// Bayer 8×8, from the classic recursive construction. Values are 0..63; the shader divides by 64
// and recentres to ±0.5. Encoding the matrix inline (instead of a loop) keeps the fragment
// program branch-free and the pattern explicit.
const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];

// Build the GLSL float-array initializer once at module load. Every value gets a trailing `.0`
// so the array constructor's elements are float-typed (ANGLE rejects int literals here).
const BAYER_FLAT = BAYER8.map((v) => `${v}.0`).join(",");

export const ditherPass: EffectPass = {
  name: "dither",
  uniformNames: ["uStrength"],
  frag: `
uniform float uStrength;

// Bayer-8 threshold at the fragment's position, recentred to ±1 so strength 1 = ±1 LSB peak.
// (v/32 − 1 ∈ [−1, 0.969]: the 8×8 matrix's max is 63, which lands just under +1.)
const float BAYER[64] = float[](
  ${BAYER_FLAT}
);
float kinoBayer(vec2 p) {
  ivec2 g = ivec2(p) & 7;
  float v = BAYER[g.y * 8 + g.x];
  return (v / 32.0 - 1.0);
}

void main() {
  vec4 src = texture(uSrc, gl_FragCoord.xy / uRes);
  if (uStrength <= 0.0) { kino_frag = src; return; }
  // Work in gamma space: the banding an audience sees is in displayed (sRGB) values, and a
  // linear-space offset of 1 LSB would be near-invisible in shadows — the exact place banding
  // lives. The film pass already established the gamma-space convention for perceptual effects.
  vec3 c = kinoToSRGB(src.rgb);
  c += kinoBayer(gl_FragCoord.xy) * uStrength * (1.0 / 255.0);
  kino_frag = vec4(kinoToLinear(clamp(c, 0.0, 1.0)), src.a);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uStrength, numParam(params, "strength", 0.5, 0, 1));
  },
};

/**
 * Test hook: render a near-black ramp through the dither and count how many DISTINCT 8-bit
 * levels it produces along a row. This is the exact measure of the banding defect — the raw 8-bit
 * ramp quantizes to a handful of plateaus (measured 22 values / 1920 rows on #000 → #0a0a10), and
 * a working dither must turn those plateaus back into a spread of neighbouring levels. Returns
 * the distinct-value count with the dither OFF and ON for the same row, so the test asserts the
 * delta rather than an absolute (which would depend on the ramp and the rasteriser).
 */
export function probeDitherDistinctLevels(canvas: HTMLCanvasElement, strength: number): { off: number; on: number } {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const w = canvas.width;
  const h = canvas.height;

  // A vertical near-black ramp: row y gets y/(h-1) of the way from #000 to #0a0a10, all in
  // PREMULTIPLIED sRGB-ish values as the pool targets store them. The pass converts to sRGB
  // before dithering, so feeding linear values would double-encode; feed raw bytes that decode
  // to the ramp's linear equivalents and let the pass's own kinoToSRGB do the perceptual move.
  const c2d = document.createElement("canvas");
  c2d.width = w;
  c2d.height = h;
  const ctx = c2d.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#000000");
  grad.addColorStop(1, "#0a0a10");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

  // Copy the ramp INTO a real pooled target (blit, like probePostChain) so the chain reads a
  // proper fbo-backed source, not a bare texture.
  const src = pool.acquire(gl, w, h);
  const blitSrc = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, blitSrc);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, blitSrc);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, src.fbo);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  const run = (passes: Array<{ pass: EffectPass; params: Record<string, number | string> }>): number => {
    const out = runChain(gl, pool, src, passes, 0);
    // Read a COLUMN (the ramp runs vertically), so the count is over the gradient direction —
    // the axis where plateaus form. 8-bit sRGB values as stored.
    const px = new Uint8Array(h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(Math.round(w / 2), 0, 1, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const levels = new Set<number>();
    for (let y = 0; y < h; y++) levels.add(px[y * 4]);
    if (out !== src) pool.release(out);
    return levels.size;
  };

  return {
    off: run([]),
    on: run([{ pass: ditherPass, params: { strength } }]),
  };
}
