// GPU→CPU readback so backdrop-sampling motion effects can use the compositor composite.
//
// This is the hot path on any frame carrying a glass overlay. Measured at SS=2 before the
// downsample below: 67ms/frame, 85% of all page-side work, and ~75% of the entire cost of
// rendering at SS=2 rather than SS=1. The naive version read the SUPERSAMPLED composite
// (2160×3840×4 = 33MB off the GPU), allocated a fresh 33MB ImageData, flipped it row by row in
// JS, and putImageData'd it — ~130MB of memory traffic per frame.
//
// None of that resolution survived: the consumer (page/liquidGlass.ts) crops this to the glass
// card's rect and drawImage-downscales it to COMPOSITION pixels before uploading. So we downsample
// to output resolution on the GPU first — flipping V in the same pass, which turns the row-by-row
// JS flip into one memcpy — and read back 4× fewer bytes into reused buffers.
//
// The real fix is never leaving the GPU: registerBackdropTexture + rendering the glass mirrors in
// the compositor's own context. That is deferred and tracked in
// docs/liquid-glass-compositor-todo.md — WebGL textures cannot cross contexts, and glass currently
// travels through the motion layer's own 2D raster.
import { registerBackdrop } from "../backdrop.js";
import type { RenderTarget, TargetPool } from "./targets.js";

let canvas: HTMLCanvasElement | null = null;
let canvasW = 0;
let canvasH = 0;
let pixels: Uint8Array | null = null;
let imageData: ImageData | null = null;

const FLIP_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Samples with V inverted: a RENDERED target holds the visual top at the HIGH GL row, and
// readPixels returns rows from GL row 0 up. Writing flipped means row 0 of the readback is the
// visual top, so the CPU side is a straight copy instead of a per-row reversal.
const FLIP_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
out vec4 kino_frag;
void main() {
  kino_frag = vec4(texture(uSrc, vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y)).rgb, 1.0);
}`;

interface FlipProgram {
  prog: WebGLProgram;
  uSrc: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
}
const flipPrograms = new WeakMap<WebGL2RenderingContext, FlipProgram | null>();

function flipProgram(gl: WebGL2RenderingContext): FlipProgram | null {
  if (flipPrograms.has(gl)) return flipPrograms.get(gl)!;
  const sh = (type: number, src: string): WebGLShader | null => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = sh(gl.VERTEX_SHADER, FLIP_VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FLIP_FRAG);
  let entry: FlipProgram | null = null;
  if (vs && fs) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      entry = { prog, uSrc: gl.getUniformLocation(prog, "uSrc"), uRes: gl.getUniformLocation(prog, "uRes") };
    }
  }
  flipPrograms.set(gl, entry);
  return entry;
}

/**
 * Publish the current composite beneath a motion layer as a 2D canvas backdrop.
 *
 * Pass `pool` plus the output dimensions to take the downsampled path; without them this falls
 * back to a full-resolution readback with the JS row flip (correct, just 4× more traffic at SS=2).
 */
export function publishCompositorBackdrop(
  gl: WebGL2RenderingContext,
  target: RenderTarget,
  pool?: TargetPool,
  outW?: number,
  outH?: number,
): void {
  const flip = outW && outH && (outW !== target.w || outH !== target.h) ? flipProgram(gl) : null;
  const scaled = Boolean(pool && flip);
  const w = scaled ? Math.max(1, Math.round(outW!)) : target.w;
  const h = scaled ? Math.max(1, Math.round(outH!)) : target.h;

  if (!canvas || canvasW !== w || canvasH !== h) {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvasW = w;
    canvasH = h;
    pixels = null;
    imageData = null;
  }
  const need = w * h * 4;
  if (!pixels || pixels.length !== need) pixels = new Uint8Array(need);

  let scratch: RenderTarget | null = null;
  if (scaled) {
    scratch = pool!.acquire(gl, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(flip!.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(flip!.uSrc, 0);
    gl.uniform2f(flip!.uRes, w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
  }
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  if (scratch) pool!.release(scratch);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!imageData || imageData.width !== w || imageData.height !== h) imageData = ctx.createImageData(w, h);
  const out = imageData.data;
  if (scaled) {
    out.set(pixels); // already top-down: the GPU pass flipped V
  } else {
    const row = w * 4;
    for (let y = 0; y < h; y++) {
      out.set(pixels.subarray((h - 1 - y) * row, (h - 1 - y) * row + row), y * row);
    }
  }
  ctx.putImageData(imageData, 0, 0);
  registerBackdrop(canvas, w, h);
}

/** @deprecated use publishCompositorBackdrop */
export const publishGlassBackdrop = publishCompositorBackdrop;
