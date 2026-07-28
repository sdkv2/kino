import { registerPass, runChain, getPass } from "./chain.js";
import { TargetPool, type RenderTarget } from "../targets.js";
import type { EffectPass } from "./pass.js";
import { blurPass } from "./blur.js";
import { gradePass } from "./grade.js";
import { glowPass } from "./glow.js";
import { bloomPass } from "./bloom.js";
import { lensPass } from "./lens.js";
import { filmPass } from "./film.js";
import { motionBlurPass } from "./motionBlur.js";

registerPass(blurPass);
registerPass(gradePass);
registerPass(glowPass);
registerPass(bloomPass);
registerPass(lensPass);
registerPass(filmPass);
registerPass(motionBlurPass);

export { registerPass, runChain, getPass };
export type { EffectPass };
export { blurPass, gradePass, glowPass, bloomPass, lensPass, filmPass, motionBlurPass };

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
