// Minimal textured-quad blits on the compositor GL context — shared by lens GPU compositing.
import { uploadCanvasOrImage } from "./compositor/providers/upload.js";

// Large-triangle verts at (0,0)/(2,0)/(0,2) cover the unit square in UV.
// Geometry spans 2× uDst; fragments outside UV 0..1 are discarded, and blitTexture also
// scissors to uDst — without that, CLAMP-edge rim pixels smear across the extra half.
const BLIT_VERT = `#version 300 es
uniform vec4 uDst;
uniform vec2 uRes;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  vec2 px = vec2(uDst.x + p.x * uDst.z, uDst.y + p.y * uDst.w);
  vec2 clip = vec2(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const BLIT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec4 uDst;
uniform vec4 uSrc;
uniform float uFlipY;
uniform float uOpacity;
uniform float uAlphaCut;
uniform float uCornerR;
in vec2 vUv;
out vec4 kino_frag;
void main() {
  if (vUv.x > 1.001 || vUv.y > 1.001) discard;
  vec2 uv = uSrc.xy + vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y) * uSrc.zw;
  vec4 s = texture(uTex, uv) * uOpacity;
  // Rounded-rect coverage (hoisted quads carry the border-radius the raster used to clip with).
  // SDF in dst px, ~1px AA edge; premultiplied source, so scaling all channels is correct.
  if (uCornerR > 0.0) {
    vec2 pc = (vUv - 0.5) * uDst.zw;
    vec2 q = abs(pc) - (uDst.zw * 0.5 - vec2(uCornerR));
    float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - uCornerR;
    s *= clamp(0.5 - d, 0.0, 1.0);
  }
  // Chrome over glass: FO AA fringe is partial-alpha dark. Discard it (keep glass);
  // force near-opaque texels to a=1 so they don't darken the mirror underneath.
  if (uAlphaCut > 0.0) {
    if (s.a < uAlphaCut) discard;
    kino_frag = vec4(s.rgb / max(s.a, 1e-4), 1.0);
    return;
  }
  kino_frag = s;
}`;

interface BlitProgram {
  prog: WebGLProgram;
  uDst: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uSrc: WebGLUniformLocation | null;
  uFlipY: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uAlphaCut: WebGLUniformLocation | null;
  uCornerR: WebGLUniformLocation | null;
}

const programs = new WeakMap<WebGL2RenderingContext, BlitProgram | null>();
// Bump when BLIT_FRAG/VERT changes — WeakMap otherwise keeps a stale linked program on reused GL.
const BLIT_PROG_VER = 14;
const programVer = new WeakMap<WebGL2RenderingContext, number>();

function blitProgram(gl: WebGL2RenderingContext): BlitProgram | null {
  if (programs.has(gl) && programVer.get(gl) === BLIT_PROG_VER) return programs.get(gl)!;
  programVer.set(gl, BLIT_PROG_VER);
  const mk = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = mk(gl.VERTEX_SHADER, BLIT_VERT);
  const fs = mk(gl.FRAGMENT_SHADER, BLIT_FRAG);
  let entry: BlitProgram | null = null;
  if (vs && fs) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      entry = {
        prog,
        uDst: gl.getUniformLocation(prog, "uDst"),
        uRes: gl.getUniformLocation(prog, "uRes"),
        uTex: gl.getUniformLocation(prog, "uTex"),
        uSrc: gl.getUniformLocation(prog, "uSrc"),
        uFlipY: gl.getUniformLocation(prog, "uFlipY"),
        uOpacity: gl.getUniformLocation(prog, "uOpacity"),
        uAlphaCut: gl.getUniformLocation(prog, "uAlphaCut"),
        uCornerR: gl.getUniformLocation(prog, "uCornerR"),
      };
    }
  }
  programs.set(gl, entry);
  return entry;
}

export interface GpuFbo {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const fboPools = new WeakMap<WebGL2RenderingContext, Map<string, GpuFbo>>();

export function acquireGpuFbo(gl: WebGL2RenderingContext, w: number, h: number, key = "layer"): GpuFbo {
  let pool = fboPools.get(gl);
  if (!pool) {
    pool = new Map();
    fboPools.set(gl, pool);
  }
  const id = `${key}:${w}x${h}`;
  let fbo = pool.get(id);
  if (!fbo || fbo.w !== w || fbo.h !== h) {
    if (fbo) {
      gl.deleteFramebuffer(fbo.fbo);
      gl.deleteTexture(fbo.tex);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbo = { fbo: fb, tex, w, h };
    pool.set(id, fbo);
  }
  return fbo;
}

const uploadedTextures = new WeakMap<WebGL2RenderingContext, WeakMap<CanvasImageSource, WebGLTexture>>();

export function uploadCanvas(gl: WebGL2RenderingContext, src: CanvasImageSource): WebGLTexture {
  let perGl = uploadedTextures.get(gl);
  if (!perGl) {
    perGl = new WeakMap();
    uploadedTextures.set(gl, perGl);
  }
  const existing = perGl.get(src);
  // srgb:false — gpuBlit's passes are outside the compositor's linear zone: they sample these as
  // sRGB and write plain RGBA8 targets. See uploadCanvasOrImage.
  return uploadCanvasOrImage(gl, existing ?? null, src, { srgb: false });
}

/** Blit a texture sub-rect into a destination FBO rect. `flipY`: 0 = uploaded, 1 = rendered target.
 *  `alphaCut` > 0: discard low-alpha FO fringe (kills black seams on glass) and force opaque.
 *  `cornerRadius` > 0 (dst px): rounded-rect coverage mask — hoisted quads carry the radius the
 *  raster's overflow clip used to apply. */
export function blitTexture(
  gl: WebGL2RenderingContext,
  dst: GpuFbo,
  srcTex: WebGLTexture,
  flipY: 0 | 1,
  dstX: number,
  dstY: number,
  dstW: number,
  dstH: number,
  srcX: number,
  srcY: number,
  srcW: number,
  srcH: number,
  texW: number,
  texH: number,
  opacity = 1,
  alphaCut = 0,
  cornerRadius = 0,
): void {
  const p = blitProgram(gl);
  if (!p || dstW < 1 || dstH < 1) return;
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const prevScissor = gl.getParameter(gl.SCISSOR_TEST) as boolean;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dst.w, dst.h);
  // FB scissor origin is bottom-left; uDst is top-left.
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(
    Math.max(0, Math.round(dstX)),
    Math.max(0, Math.round(dst.h - dstY - dstH)),
    Math.max(0, Math.round(dstW)),
    Math.max(0, Math.round(dstH)),
  );
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(p.prog);
  gl.uniform4f(p.uDst, dstX, dstY, dstW, dstH);
  gl.uniform2f(p.uRes, dst.w, dst.h);
  gl.uniform4f(p.uSrc, srcX / texW, srcY / texH, srcW / texW, srcH / texH);
  gl.uniform1f(p.uFlipY, flipY);
  gl.uniform1f(p.uOpacity, opacity);
  gl.uniform1f(p.uAlphaCut, alphaCut);
  gl.uniform1f(p.uCornerR, cornerRadius);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(p.uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (!prevScissor) gl.disable(gl.SCISSOR_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
}
