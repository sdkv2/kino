import { registerPass, runChain, getPass } from "./chain.js";
import { TargetPool, type RenderTarget } from "../targets.js";
import type { EffectPass } from "./pass.js";
import { blurPass } from "./blur.js";
import { gradePass } from "./grade.js";
import { glowPass } from "./glow.js";
import { bloomPass, bloomCompositePass } from "./bloom.js";
import { lensPass } from "./lens.js";
import { filmPass } from "./film.js";
import { motionBlurPass } from "./motionBlur.js";

registerPass(blurPass);
registerPass(gradePass);
registerPass(glowPass);
registerPass(bloomPass);
registerPass(bloomCompositePass);
registerPass(lensPass);
registerPass(filmPass);
registerPass(motionBlurPass);

export { registerPass, runChain, getPass };
export type { EffectPass };
export { blurPass, gradePass, glowPass, bloomPass, bloomCompositePass, lensPass, filmPass, motionBlurPass };

/** Test hook. Renders a half-white / half-transparent source with a soft-edged coloured band,
 *  runs one effect, and reads back four numbers:
 *    [0] the pixel just outside the hard edge  [1] green at a coloured pixel
 *    [2] blue at that pixel                    [3] darkening at a soft edge (premultiply check)
 */
export function probeEffect(
  canvas: HTMLCanvasElement,
  effect: string,
  params: Record<string, number>,
): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();

  // Paint the source through a 2D canvas so the fixture is readable and its alpha is real.
  const c2d = document.createElement("canvas");
  c2d.width = canvas.width;
  c2d.height = canvas.height;
  const ctx = c2d.getContext("2d")!;
  ctx.clearRect(0, 0, c2d.width, c2d.height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, c2d.width / 2, c2d.height);          // hard edge at x = w/2
  ctx.fillStyle = "#ff6600";
  ctx.fillRect(4, 4, 8, 8);                                // coloured probe pixel region
  const grad = ctx.createLinearGradient(0, c2d.height - 12, 0, c2d.height);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, c2d.height - 12, c2d.width, 12);          // soft edge for the premultiply check

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

  const src: RenderTarget = { fbo: null as any, tex, w: canvas.width, h: canvas.height };
  const out = runChain(gl, pool, src, [{ pass: getPass(effect)!, params }], 0);
  const read = (x: number, y: number): Uint8Array => {
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const edge = read(canvas.width / 2 + 1, canvas.height / 2)[0];
  const colour = read(8, 8);
  const softTop = read(2, canvas.height - 12)[0];
  const softMid = read(2, canvas.height - 6)[0];
  return [edge, colour[1], colour[2], Math.max(0, softTop - softMid * 2)];
}

/**
 * Test hook: grain STRUCTURE on a flat patch of a given level, sampled along the centre row
 * where the vignette contributes nothing.
 *
 * `spread` is how strong the grain is; `adjacentDiff` is the mean step between neighbouring
 * pixels. Their RATIO is what separates film grain from digital noise: independent per-pixel
 * noise steps as far between neighbours as it does overall (ratio ≈ 1), while real grain has a
 * clump size, so neighbours are correlated and the ratio falls well below 1.
 */
export function probeGrain(
  canvas: HTMLCanvasElement,
  night: string,
  intensity: number,
  level: number,
  ss = 1,
  extra: Record<string, number> = {},
  frame = 7,
): { spread: number; adjacentDiff: number; samples: number[] } {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  // film runs before the supersample resolve, so the pass sees RENDER pixels. Reproduce that here
  // — render at w*ss and box-average ss x ss blocks back down — or the probe cannot tell whether
  // the grain's clump size actually survives the resolve at output resolution.
  const rw = canvas.width * ss;
  const rh = canvas.height * ss;
  const src = pool.acquire(gl, rw, rh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.viewport(0, 0, src.w, src.h);
  gl.clearColor(level, level, level, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const out = runChain(gl, pool, src, [{ pass: getPass("film")!, params: { ...extra, intensity, night, ss } }], frame);

  const n = 48;
  const y0 = Math.floor(rh / 2);
  const x0 = Math.floor(rw / 2 - (n * ss) / 2);
  const block = new Uint8Array(n * ss * ss * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.readPixels(x0, y0, n * ss, ss, gl.RGBA, gl.UNSIGNED_BYTE, block);
  const v = Array.from({ length: n }, (_, i) => {
    let sum = 0;
    for (let dy = 0; dy < ss; dy++) {
      for (let dx = 0; dx < ss; dx++) sum += block[((dy * n * ss) + i * ss + dx) * 4];
    }
    return sum / (ss * ss);
  });

  const mean = v.reduce((a, b) => a + b, 0) / n;
  const spread = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let steps = 0;
  for (let i = 1; i < n; i++) steps += Math.abs(v[i] - v[i - 1]);
  const adjacentDiff = steps / (n - 1);

  pool.release(src);
  if (out !== src) pool.release(out);
  return { spread, adjacentDiff, samples: v };
}

/** Test hook: white source through the film pass — centre, corner, grain spread on a flat patch. */
export function probeFilm(
  canvas: HTMLCanvasElement,
  night: string,
  intensity: number,
): { centre: number; corner: number; grainSpread: number } {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const src = pool.acquire(gl, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.viewport(0, 0, src.w, src.h);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  const out = runChain(gl, pool, src, [{ pass: getPass("film")!, params: { intensity, night } }], 42);
  const read = (x: number, y: number): number => {
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[0];
  };
  const centre = read(canvas.width / 2, canvas.height / 2);
  const corner = read(2, 2);
  let sum = 0;
  let sumSq = 0;
  const n = 16;
  for (let i = 0; i < n; i++) {
    const v = read(20 + i, 20);
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  const grainSpread = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
  pool.release(src);
  if (out !== src) pool.release(out);
  return { centre, corner, grainSpread };
}

// The full-post-chain probe lives in post.ts (it needs runPost), but is re-exported here so it
// reaches the same KinoFx global the effect probes use — and so importing it registers the passes.
export { probePostChain } from "../post.js";
