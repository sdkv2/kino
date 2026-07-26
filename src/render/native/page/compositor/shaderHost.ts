// Compositor-side shader background — lifted from ShaderBackground.tsx without React.
import { reportFatal } from "../fatal.js";
import type { BgKeyframe, BgParamValue, BgTrigger } from "../../../props.js";
import { paramsAt, pulseAt } from "../../../bgparams.js";
import { assembleShaderSource, resolveUniforms, fitTextureDims, extraParamNames } from "../../../shaderSource.js";
import { registerBackdrop } from "../backdrop.js";
import { getBgTextures } from "../bgTextures.js";
import { shaderFXAA } from "../../shaderQuality.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FXAA_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uInvRes;
out vec4 kino_frag;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 uv = gl_FragCoord.xy * uInvRes;
  vec3 m  = texture(uSrc, uv).rgb;
  vec3 nw = texture(uSrc, uv + vec2(-1.0,-1.0) * uInvRes).rgb;
  vec3 ne = texture(uSrc, uv + vec2( 1.0,-1.0) * uInvRes).rgb;
  vec3 sw = texture(uSrc, uv + vec2(-1.0, 1.0) * uInvRes).rgb;
  vec3 se = texture(uSrc, uv + vec2( 1.0, 1.0) * uInvRes).rgb;
  float lm = lum(m), lnw = lum(nw), lne = lum(ne), lsw = lum(sw), lse = lum(se);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin < max(0.05, lmax * 0.10)) { kino_frag = vec4(m, 1.0); return; }
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * uInvRes;
  vec3 a = 0.5 * (texture(uSrc, uv + dir * (-1.0/6.0)).rgb + texture(uSrc, uv + dir * (1.0/6.0)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uSrc, uv + dir * -0.5).rgb + texture(uSrc, uv + dir * 0.5).rgb);
  float lb = lum(b);
  kino_frag = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
}`;

const FXAA_UNIT = 4;

interface Program {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  texHandles: (WebGLTexture | null)[];
  texRevisions: number[];
  fxaa: WebGLProgram | null;
  fxaaLoc: { uSrc: WebGLUniformLocation | null; uInvRes: WebGLUniformLocation | null };
  fbo: WebGLFramebuffer | null;
  fboTex: WebGLTexture | null;
  fboW: number;
  fboH: number;
}

function uploadTex(gl: WebGL2RenderingContext, t: { source: unknown; width: number; height: number }): void {
  const srcIn = t.source as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number };
  const srcW = srcIn.naturalWidth ?? srcIn.width ?? t.width;
  const srcH = srcIn.naturalHeight ?? srcIn.height ?? t.height;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const [w, h] = fitTextureDims(srcW, srcH, max);
  let src = t.source as TexImageSource;
  if (w !== srcW || h !== srcH) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (ctx) {
      ctx.drawImage(t.source as CanvasImageSource, 0, 0, w, h);
      src = c;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
}

function bindTransparent1x1(gl: WebGL2RenderingContext, unit: number): WebGLTexture {
  const handle = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return handle;
}

function compile(canvas: HTMLCanvasElement, fragSrc: string): Program | string {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
  if (!gl) return "webgl2 unavailable";
  const mk = (type: number, src: string): WebGLShader | string => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return gl.getShaderInfoLog(sh) ?? "shader compile failed";
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, VERT);
  if (typeof vs === "string") return vs;
  const fs = mk(gl.FRAGMENT_SHADER, fragSrc);
  if (typeof fs === "string") return fs;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return gl.getProgramInfoLog(prog) ?? "program link failed";
  const names = ["iResolution", "iTime", "iFrame", "iTimeDelta", "iMouse", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity", "uParam0", "uParam1", "uParam2", "uParam3"];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  const buildFxaa = (): WebGLProgram | null => {
    const fvs = mk(gl.VERTEX_SHADER, VERT);
    const ffs = mk(gl.FRAGMENT_SHADER, FXAA_FRAG);
    if (typeof fvs === "string" || typeof ffs === "string") return null;
    const fp = gl.createProgram()!;
    gl.attachShader(fp, fvs);
    gl.attachShader(fp, ffs);
    gl.linkProgram(fp);
    return gl.getProgramParameter(fp, gl.LINK_STATUS) ? fp : null;
  };
  const fxaa = buildFxaa();
  const fxaaLoc = {
    uSrc: fxaa ? gl.getUniformLocation(fxaa, "uSrc") : null,
    uInvRes: fxaa ? gl.getUniformLocation(fxaa, "uInvRes") : null,
  };
  if (fxaa) {
    gl.useProgram(fxaa);
    gl.uniform1i(fxaaLoc.uSrc, FXAA_UNIT);
  }
  gl.useProgram(prog);
  const texes = getBgTextures();
  const texHandles: (WebGLTexture | null)[] = [null, null, null, null];
  const texRevisions = [-1, -1, -1, -1];
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (let i = 0; i < 4; i++) {
    const t = texes[i];
    const uTex = gl.getUniformLocation(prog, `uTex${i}`);
    const uSize = gl.getUniformLocation(prog, `uTexSize${i}`);
    if (!t) {
      const empty = bindTransparent1x1(gl, i);
      if (uTex) gl.uniform1i(uTex, i);
      if (uSize) gl.uniform2f(uSize, 0, 0);
      texHandles[i] = empty;
      continue;
    }
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    uploadTex(gl, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (uTex) gl.uniform1i(uTex, i);
    if (uSize) gl.uniform2f(uSize, t.width, t.height);
    texHandles[i] = handle;
    texRevisions[i] = t.revision;
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return { gl, prog, loc, texHandles, texRevisions, fxaa, fxaaLoc, fbo: null, fboTex: null, fboW: 0, fboH: 0 };
}

function ensureFbo(p: Program, W: number, H: number): void {
  const { gl } = p;
  if (!p.fbo) p.fbo = gl.createFramebuffer();
  if (!p.fboTex) p.fboTex = gl.createTexture();
  if (p.fboW === W && p.fboH === H) return;
  gl.activeTexture(gl.TEXTURE0 + FXAA_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, p.fboTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, p.fboTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  p.fboW = W;
  p.fboH = H;
}

function syncLiveTextures(p: Program): void {
  const texes = getBgTextures();
  const { gl } = p;
  let flipped = false;
  for (let i = 0; i < 4; i++) {
    const t = texes[i];
    const handle = p.texHandles[i];
    if (!t || !handle || p.texRevisions[i] === t.revision) continue;
    if (!flipped) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      flipped = true;
    }
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    uploadTex(gl, t);
    p.texRevisions[i] = t.revision;
  }
  if (flipped) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

export function createShaderDraw(opts: {
  shaderSrc: string;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  width: number;
  height: number;
  fps: number;
}): (canvas: HTMLCanvasElement, frame: number) => void {
  let prog: Program | null = null;
  let err: { log: string; src: string } | null = null;
  let key: string | null = null;

  return (canvas, frame) => {
    const extras = extraParamNames(opts.params, opts.keyframes);
    const nextKey = `${extras.join(",")}\0${opts.shaderSrc}`;
    if (key !== nextKey) {
      key = nextKey;
      prog = null;
      err = null;
    }
    if (err) {
      reportFatal("ShaderBackground failed to build", err.log, err.src);
      return;
    }
    if (!prog) {
      const assembled = assembleShaderSource(opts.shaderSrc, extras);
      const built = compile(canvas, assembled);
      if (typeof built === "string") {
        err = { log: built, src: assembled };
        reportFatal("ShaderBackground failed to build", built, assembled);
        return;
      }
      prog = built;
    }
    const p = prog;
    const { gl, loc } = p;
    const tt = opts.fps > 0 ? frame / opts.fps : 0;
    const W = opts.width;
    const H = opts.height;
    const u = resolveUniforms(
      paramsAt(opts.params, opts.keyframes, tt),
      { frame, fps: opts.fps, width: W, height: H, pulse: pulseAt(opts.triggers, tt) },
      extras,
    );
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const useFxaa = shaderFXAA() && p.fxaa !== null;
    if (useFxaa) {
      ensureFbo(p, W, H);
      gl.activeTexture(gl.TEXTURE0 + FXAA_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, useFxaa ? p.fbo : null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(p.prog);
    syncLiveTextures(p);
    gl.uniform3f(loc.iResolution, u.iResolution[0], u.iResolution[1], u.iResolution[2]);
    gl.uniform1f(loc.iTime, u.iTime);
    gl.uniform1i(loc.iFrame, u.iFrame);
    gl.uniform1f(loc.iTimeDelta, u.iTimeDelta);
    gl.uniform4f(loc.iMouse, 0, 0, 0, 0);
    gl.uniform1f(loc.uPulse, u.uPulse);
    gl.uniform3fv(loc.uColorA, u.uColorA);
    gl.uniform3fv(loc.uColorB, u.uColorB);
    gl.uniform3fv(loc.uColorC, u.uColorC);
    gl.uniform1f(loc.uIntensity, u.uIntensity);
    gl.uniform1f(loc.uParam0, u.uParams[0]);
    gl.uniform1f(loc.uParam1, u.uParams[1]);
    gl.uniform1f(loc.uParam2, u.uParams[2]);
    gl.uniform1f(loc.uParam3, u.uParams[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (useFxaa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, W, H);
      gl.useProgram(p.fxaa);
      gl.activeTexture(gl.TEXTURE0 + FXAA_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, p.fboTex);
      gl.uniform2f(p.fxaaLoc.uInvRes, 1 / W, 1 / H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.finish();
    registerBackdrop(canvas, W, H);
  };
}
