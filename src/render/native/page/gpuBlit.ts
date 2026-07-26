// Minimal textured-quad blits on the compositor GL context — shared by kino-glass GPU compositing.
import { uploadCanvasOrImage } from "./compositor/providers/upload.js";

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
uniform vec4 uSrc;
uniform float uFlipY;
uniform float uOpacity;
in vec2 vUv;
out vec4 kino_frag;
void main() {
  vec2 uv = uSrc.xy + vec2(vUv.x, uFlipY > 0.5 ? 1.0 - vUv.y : vUv.y) * uSrc.zw;
  kino_frag = texture(uTex, uv) * uOpacity;
}`;

interface BlitProgram {
  prog: WebGLProgram;
  uDst: WebGLUniformLocation | null;
  uRes: WebGLUniformLocation | null;
  uTex: WebGLUniformLocation | null;
  uSrc: WebGLUniformLocation | null;
  uFlipY: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
}

const programs = new WeakMap<WebGL2RenderingContext, BlitProgram | null>();

function blitProgram(gl: WebGL2RenderingContext): BlitProgram | null {
  if (programs.has(gl)) return programs.get(gl)!;
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
  return uploadCanvasOrImage(gl, existing ?? null, src);
}

/** Blit a texture sub-rect into a destination FBO rect. `flipY`: 0 = uploaded, 1 = rendered target. */
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
): void {
  const p = blitProgram(gl);
  if (!p || dstW < 1 || dstH < 1) return;
  const prevFb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dst.w, dst.h);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(p.prog);
  gl.uniform4f(p.uDst, dstX, dstY, dstW, dstH);
  gl.uniform2f(p.uRes, dst.w, dst.h);
  gl.uniform4f(p.uSrc, srcX / texW, srcY / texH, srcW / texW, srcH / texH);
  gl.uniform1f(p.uFlipY, flipY);
  gl.uniform1f(p.uOpacity, opacity);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.uniform1i(p.uTex, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, prevFb);
}
