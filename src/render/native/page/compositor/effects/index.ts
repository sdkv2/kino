import { registerPass, runChain, getPass } from "./chain.js";
import { TargetPool, type RenderTarget } from "../targets.js";
import type { EffectPass } from "./pass.js";
import { blurPass } from "./blur.js";
import { gradePass } from "./grade.js";
import { glowPass } from "./glow.js";

registerPass(blurPass);
registerPass(gradePass);
registerPass(glowPass);

export { registerPass, runChain, getPass };
export type { EffectPass };
export { blurPass, gradePass, glowPass };

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
  const colour = read(8, canvas.height - 8);
  const softTop = read(2, canvas.height - 12)[0];
  const softMid = read(2, canvas.height - 6)[0];
  return [edge, colour[1], colour[2], Math.max(0, softTop - softMid * 2)];
}
