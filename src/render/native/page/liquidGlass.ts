// Liquid-glass runtime: per-pixel edge refraction for motion elements tagged `class="kino-glass"`.
// Silhouette: `border-radius` round-rect (default) or inline `<svg class="kino-glass-shape">` mask.

import { peekBackdrop, peekBackdropTexture, type BackdropTexture } from "./backdrop.js";
import { rasterGlassShapeMask } from "./glassShape.js";
import { reportFatal } from "./fatal";
import { shaderSS } from "../shaderQuality.js";

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uShape;
uniform vec4 uBgRect;
uniform float uIsFullBg;
uniform float uUseShape;
uniform vec2 uSize;
uniform float uRadius;
uniform float uBand;
uniform float uStrength;
uniform float uChroma;
uniform float uProfile;
uniform vec4 uFilm;
uniform float uSaturate;
uniform float uBrightness;
uniform float uFrost;
uniform float uEdgeBlur;
uniform float uSS;
out vec4 outColor;

float sdRoundRect(vec2 p, vec2 center, vec2 half_, float r) {
  vec2 c = p - center;
  vec2 q = abs(c) - (half_ - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float maskAlpha(vec2 px) {
  vec2 uv = vec2(px.x / uSize.x, 1.0 - px.y / uSize.y);
  return texture(uShape, clamp(uv, vec2(0.001), vec2(0.999))).a;
}

float maskShapeSd(vec2 p) {
  float a = maskAlpha(p);
  float e = max(1.5, 1.0 / uSS);
  float ax = maskAlpha(p + vec2(e, 0.0)) - maskAlpha(p - vec2(e, 0.0));
  float ay = maskAlpha(p + vec2(0.0, e)) - maskAlpha(p - vec2(0.0, e));
  float g = length(vec2(ax, ay)) + 1e-4;
  return (0.5 - a) / g * e;
}

float shapeSd(vec2 p) {
  if (uUseShape > 0.5) return maskShapeSd(p);
  vec2 center = 0.5 * uSize;
  vec2 half_ = 0.5 * uSize;
  float r = min(uRadius, min(half_.x, half_.y));
  return sdRoundRect(p, center, half_, r);
}

vec3 sampleBg(vec2 px) {
  if (uIsFullBg > 0.5) {
    vec2 localUv = vec2(px.x / uSize.x, 1.0 - px.y / uSize.y);
    vec2 uv = uBgRect.xy + localUv * uBgRect.zw;
    return texture(uBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }
  vec2 uv = px / uSize;
  return texture(uBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

vec3 sampleBgBlur(vec2 px, float radius) {
  if (radius < 0.35) return sampleBg(px);
  vec3 a = sampleBg(px) * 2.0;
  a += sampleBg(px + vec2(1.0, 0.0) * radius);
  a += sampleBg(px + vec2(-1.0, 0.0) * radius);
  a += sampleBg(px + vec2(0.0, 1.0) * radius);
  a += sampleBg(px + vec2(0.0, -1.0) * radius);
  float o = radius * 0.71;
  a += sampleBg(px + vec2(0.707, 0.707) * o);
  a += sampleBg(px + vec2(-0.707, 0.707) * o);
  a += sampleBg(px + vec2(0.707, -0.707) * o);
  a += sampleBg(px + vec2(-0.707, -0.707) * o);
  float o2 = radius * 1.35;
  a += sampleBg(px + vec2(1.0, 0.0) * o2);
  a += sampleBg(px + vec2(-1.0, 0.0) * o2);
  a += sampleBg(px + vec2(0.0, 1.0) * o2);
  a += sampleBg(px + vec2(0.0, -1.0) * o2);
  float o3 = radius * 1.1;
  a += sampleBg(px + vec2(0.707, 0.707) * o3);
  a += sampleBg(px + vec2(-0.707, 0.707) * o3);
  a += sampleBg(px + vec2(0.707, -0.707) * o3);
  a += sampleBg(px + vec2(-0.707, -0.707) * o3);
  return a * (1.0 / 18.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y * uSS - gl_FragCoord.y) / uSS;
  float sd = shapeSd(px);
  float d = -sd;
  float alpha = smoothstep(-3.5, 2.5, d);
  if (alpha < 0.004) {
    outColor = vec4(0.0);
    return;
  }

  float gs = clamp(uBand * 0.35, 1.2, 0.4 * min(uSize.x, uSize.y));
  vec2 e = vec2(gs, 0.0);
  vec2 gv = vec2(
    shapeSd(px + e.xy) - shapeSd(px - e.xy),
    shapeSd(px + e.yx) - shapeSd(px - e.yx));
  vec2 grad = gv / max(length(gv), 1e-4) * smoothstep(0.15, 0.6, length(gv) / (2.0 * gs));

  float edgeU = clamp(1.0 - d / max(uBand, 1.0), 0.0, 1.0);
  float f = pow(edgeU, uProfile) * uStrength;
  float blurR = uFrost * (0.55 + 0.45 * (1.0 - edgeU * 0.35)) + edgeU * edgeU * uEdgeBlur;

  vec2 base = px - grad * f;
  vec3 col = vec3(
    sampleBgBlur(base - grad * (f * uChroma), blurR).r,
    sampleBgBlur(base, blurR).g,
    sampleBgBlur(base + grad * (f * uChroma), blurR).b);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturate) * uBrightness;
  float frostAmt = clamp(uFrost / 28.0, 0.0, 1.0) * (1.0 - edgeU * 0.5);
  col = mix(col, vec3(luma), frostAmt * 0.28);
  col = mix(col, vec3(0.92, 0.95, 1.0), frostAmt * 0.12);
  col = mix(col, uFilm.rgb, uFilm.a);

  float rim = exp(-d * d / max(uBand * 0.5 + uEdgeBlur * 0.25, 1.0)) * (0.22 - 0.08 * clamp(uEdgeBlur / 64.0, 0.0, 1.0));
  col += vec3(1.0) * max(rim, 0.0);

  outColor = vec4(col * alpha, alpha);
}`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface GlassState {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  stage: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  tex: WebGLTexture;
  shapeTex: WebGLTexture;
  w: number;
  h: number;
}

const pools = new WeakMap<ShadowRoot, Map<number, GlassState>>();

function bindTex2D(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function makeState(): GlassState | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    preserveDrawingBuffer: true,
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
  });
  if (!gl) return null;
  const mk = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      reportFatal("kino-glass shader failed to compile", gl.getShaderInfoLog(sh), src);
      return null;
    }
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, VERT);
  const fs = mk(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    reportFatal("kino-glass program failed to link", gl.getProgramInfoLog(prog), FRAG);
    return null;
  }
  const names = [
    "uBg", "uShape", "uBgRect", "uIsFullBg", "uUseShape", "uSize", "uRadius", "uBand", "uStrength",
    "uChroma", "uProfile", "uFilm", "uSaturate", "uBrightness", "uFrost", "uEdgeBlur", "uSS",
  ];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  const tex = gl.createTexture()!;
  bindTex2D(gl, tex);
  const shapeTex = gl.createTexture()!;
  bindTex2D(gl, shapeTex);

  const wrapper = document.createElement("div");
  wrapper.className = "kino-glass-mirror";
  wrapper.setAttribute(
    "style",
    "position:absolute;inset:0;overflow:hidden;z-index:-1;pointer-events:none",
  );
  canvas.setAttribute("style", "width:100%;height:100%;display:block");
  wrapper.appendChild(canvas);
  const stage = document.createElement("canvas");
  return { wrapper, canvas, stage, gl, prog, loc, tex, shapeTex, w: 0, h: 0 };
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

function cssVarPx(el: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (/^-?[\d.]+(px)?$/i.test(raw)) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  const prev = el.style.width;
  el.style.width = raw;
  const px = parseFloat(getComputedStyle(el).width);
  if (prev) el.style.width = prev;
  else el.style.removeProperty("width");
  return Number.isFinite(px) ? px : fallback;
}

const colorCache = new Map<string, [number, number, number, number]>();
let colorCtx: CanvasRenderingContext2D | null = null;
function cssColor(raw: string, fallback: [number, number, number, number]): [number, number, number, number] {
  const s = raw.trim();
  if (!s) return fallback;
  const hit = colorCache.get(s);
  if (hit) return hit;
  if (!colorCtx) colorCtx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!colorCtx) return fallback;
  colorCtx.clearRect(0, 0, 1, 1);
  colorCtx.fillStyle = "#000";
  colorCtx.fillStyle = s;
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  const out: [number, number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  colorCache.set(s, out);
  return out;
}

/** Render `.kino-glass` refraction mirrors. Pass `elements` for stacked bottom→top walks. */
export function applyLiquidGlass(root: ShadowRoot | null, opts?: { elements?: HTMLElement[] }): void {
  if (!root) return;
  const allEls = root.querySelectorAll<HTMLElement>(".kino-glass");
  const els = opts?.elements ?? Array.from(allEls);
  if (els.length === 0) return;

  const backdrop = peekBackdrop();
  const backdropTexture = peekBackdropTexture();
  if (!backdrop && !backdropTexture) return;

  let pool = pools.get(root);
  if (!pool) {
    pool = new Map();
    pools.set(root, pool);
  }
  const hostBox = (root.host as HTMLElement | undefined)?.getBoundingClientRect();
  const pageW = hostBox?.width || backdropTexture?.width || backdrop?.width || window.innerWidth;
  const pageH = hostBox?.height || backdropTexture?.height || backdrop?.height || window.innerHeight;
  const scaleX = backdropTexture ? backdropTexture.width / pageW : (backdrop ? backdrop.width / pageW : 1);
  const scaleY = backdropTexture ? backdropTexture.height / pageH : (backdrop ? backdrop.height / pageH : 1);

  els.forEach((el) => {
    const i = Array.prototype.indexOf.call(allEls, el);
    if (i < 0) return;
    const state = pool!.get(i) ?? makeState();
    if (!state) return;
    pool!.set(i, state);

    if (state.wrapper.parentElement !== el) {
      el.insertBefore(state.wrapper, el.firstChild);
    }
    const cs = getComputedStyle(el);
    if (cs.position === "static") el.style.position = "relative";
    if (cs.isolation !== "isolate") el.style.isolation = "isolate";

    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 4 || h < 4) return;

    const { gl, canvas, stage, prog, loc, tex, shapeTex } = state;
    const SS = shaderSS();
    if (state.w !== w || state.h !== h) {
      canvas.width = w * SS;
      canvas.height = h * SS;
      stage.width = w;
      stage.height = h;
      state.w = w;
      state.h = h;
    } else if (canvas.width !== w * SS || canvas.height !== h * SS) {
      canvas.width = w * SS;
      canvas.height = h * SS;
    }

    const hostEl = el.getRootNode() instanceof ShadowRoot ? ((el.getRootNode() as ShadowRoot).host as HTMLElement) : null;
    const hr = hostEl ? hostEl.getBoundingClientRect() : { left: 0, top: 0 };
    const relLeft = rect.left - hr.left;
    const relTop = rect.top - hr.top;

    if (!backdropTexture && backdrop) {
      const sctx = stage.getContext("2d");
      if (!sctx) return;
      sctx.clearRect(0, 0, w, h);
      sctx.drawImage(backdrop.source, relLeft * scaleX, relTop * scaleY, w * scaleX, h * scaleY, 0, 0, w, h);
    }

    const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, Math.min(w, h) / 2);
    const strength = cssVarPx(el, "--glass-strength", 26);
    const band = cssVarPx(el, "--glass-band", Math.max(radius, 48));
    const chroma = cssVar(cs, "--glass-chroma", 0.07);
    const profile = cssVar(cs, "--glass-profile", 2.2);
    const film = cssColor(cs.getPropertyValue("--glass-film"), [1, 1, 1, 0.13]);
    const saturate = cssVar(cs, "--glass-saturate", 1.25);
    const brightness = cssVar(cs, "--glass-brightness", 1.06);
    const frost = cssVarPx(el, "--glass-frost", 0);
    const edgeBlur = cssVarPx(el, "--glass-edge-blur", 0);

    const shapeMask = rasterGlassShapeMask(el, w, h, SS);
    const useShape = shapeMask ? 1.0 : 0.0;

    gl.viewport(0, 0, w * SS, h * SS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    if (backdropTexture) {
      gl.bindTexture(gl.TEXTURE_2D, backdropTexture.tex);
      gl.uniform1f(loc.uIsFullBg, 1.0);
      gl.uniform4f(
        loc.uBgRect,
        relLeft / pageW,
        (pageH - relTop - rect.height) / pageH,
        rect.width / pageW,
        rect.height / pageH,
      );
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);
      gl.uniform1f(loc.uIsFullBg, 0.0);
      gl.uniform4f(loc.uBgRect, 0, 0, 1, 1);
    }
    gl.uniform1i(loc.uBg, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shapeTex);
    if (shapeMask) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shapeMask);
    }
    gl.uniform1i(loc.uShape, 1);
    gl.uniform1f(loc.uUseShape, useShape);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc.uSize, w, h);
    gl.uniform1f(loc.uRadius, radius);
    gl.uniform1f(loc.uBand, band);
    gl.uniform1f(loc.uStrength, strength);
    gl.uniform1f(loc.uChroma, chroma);
    gl.uniform1f(loc.uProfile, profile);
    gl.uniform4f(loc.uFilm, film[0], film[1], film[2], film[3]);
    gl.uniform1f(loc.uSaturate, saturate);
    gl.uniform1f(loc.uBrightness, brightness);
    gl.uniform1f(loc.uFrost, frost);
    gl.uniform1f(loc.uEdgeBlur, edgeBlur);
    gl.uniform1f(loc.uSS, SS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  });
}

interface SharedGlassProgram {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  shapeTex: WebGLTexture;
}

const sharedPrograms = new WeakMap<WebGL2RenderingContext, SharedGlassProgram | null>();

function sharedGlassProgram(gl: WebGL2RenderingContext): SharedGlassProgram | null {
  if (sharedPrograms.has(gl)) return sharedPrograms.get(gl)!;
  const mk = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = mk(gl.VERTEX_SHADER, VERT);
  const fs = mk(gl.FRAGMENT_SHADER, FRAG);
  let entry: SharedGlassProgram | null = null;
  if (vs && fs) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const names = [
        "uBg", "uShape", "uBgRect", "uIsFullBg", "uUseShape", "uSize", "uRadius", "uBand", "uStrength",
        "uChroma", "uProfile", "uFilm", "uSaturate", "uBrightness", "uFrost", "uEdgeBlur", "uSS",
      ];
      const loc: Record<string, WebGLUniformLocation | null> = {};
      for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
      const shapeTex = gl.createTexture()!;
      bindTex2D(gl, shapeTex);
      entry = { prog, loc, shapeTex };
    }
  }
  sharedPrograms.set(gl, entry);
  return entry;
}

interface SharedGlassFbo {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const sharedFbos = new WeakMap<WebGL2RenderingContext, SharedGlassFbo>();

function sharedGlassFbo(gl: WebGL2RenderingContext, w: number, h: number): SharedGlassFbo {
  let fbo = sharedFbos.get(gl);
  if (!fbo || fbo.w !== w || fbo.h !== h) {
    if (fbo) {
      gl.deleteFramebuffer(fbo.fbo);
      gl.deleteTexture(fbo.tex);
    }
    const tex = gl.createTexture()!;
    bindTex2D(gl, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    fbo = { fbo: fb, tex, w, h };
    sharedFbos.set(gl, fbo);
  }
  return fbo;
}

/**
 * Render one `.kino-glass` mirror into an FBO on the compositor GL context (no readback).
 */
export function renderGlassMirrorFbo(
  sharedGl: WebGL2RenderingContext,
  backdrop: Readonly<BackdropTexture>,
  el: HTMLElement,
  pageW: number,
  pageH: number,
  hostRect: DOMRect,
): SharedGlassFbo | null {
  const entry = sharedGlassProgram(sharedGl);
  if (!entry) return null;

  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (w < 4 || h < 4) return null;

  const SS = shaderSS();
  const pw = Math.max(1, w * SS);
  const ph = Math.max(1, h * SS);
  const { prog, loc, shapeTex } = entry;
  const target = sharedGlassFbo(sharedGl, pw, ph);

  const cs = getComputedStyle(el);
  const relLeft = rect.left - hostRect.left;
  const relTop = rect.top - hostRect.top;
  const radius = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, Math.min(w, h) / 2);
  const strength = cssVarPx(el, "--glass-strength", 26);
  const band = cssVarPx(el, "--glass-band", Math.max(radius, 48));
  const chroma = cssVar(cs, "--glass-chroma", 0.07);
  const profile = cssVar(cs, "--glass-profile", 2.2);
  const film = cssColor(cs.getPropertyValue("--glass-film"), [1, 1, 1, 0.13]);
  const saturate = cssVar(cs, "--glass-saturate", 1.25);
  const brightness = cssVar(cs, "--glass-brightness", 1.06);
  const frost = cssVarPx(el, "--glass-frost", 0);
  const edgeBlur = cssVarPx(el, "--glass-edge-blur", 0);
  const shapeMask = rasterGlassShapeMask(el, w, h, SS);
  const useShape = shapeMask ? 1.0 : 0.0;

  const prevFb = sharedGl.getParameter(sharedGl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  sharedGl.bindFramebuffer(sharedGl.FRAMEBUFFER, target.fbo);
  sharedGl.viewport(0, 0, pw, ph);
  sharedGl.enable(sharedGl.BLEND);
  sharedGl.blendFunc(sharedGl.ONE, sharedGl.ONE_MINUS_SRC_ALPHA);
  sharedGl.clearColor(0, 0, 0, 0);
  sharedGl.clear(sharedGl.COLOR_BUFFER_BIT);
  sharedGl.useProgram(prog);
  sharedGl.activeTexture(sharedGl.TEXTURE0);
  sharedGl.bindTexture(sharedGl.TEXTURE_2D, backdrop.tex);
  sharedGl.uniform1f(loc.uIsFullBg, 1.0);
  sharedGl.uniform4f(
    loc.uBgRect,
    relLeft / pageW,
    (pageH - relTop - rect.height) / pageH,
    rect.width / pageW,
    rect.height / pageH,
  );
  sharedGl.uniform1i(loc.uBg, 0);
  sharedGl.activeTexture(sharedGl.TEXTURE1);
  sharedGl.bindTexture(sharedGl.TEXTURE_2D, shapeTex);
  if (shapeMask) {
    sharedGl.texImage2D(sharedGl.TEXTURE_2D, 0, sharedGl.RGBA, sharedGl.RGBA, sharedGl.UNSIGNED_BYTE, shapeMask);
  }
  sharedGl.uniform1i(loc.uShape, 1);
  sharedGl.uniform1f(loc.uUseShape, useShape);
  sharedGl.activeTexture(sharedGl.TEXTURE0);
  sharedGl.uniform2f(loc.uSize, w, h);
  sharedGl.uniform1f(loc.uRadius, radius);
  sharedGl.uniform1f(loc.uBand, band);
  sharedGl.uniform1f(loc.uStrength, strength);
  sharedGl.uniform1f(loc.uChroma, chroma);
  sharedGl.uniform1f(loc.uProfile, profile);
  sharedGl.uniform4f(loc.uFilm, film[0], film[1], film[2], film[3]);
  sharedGl.uniform1f(loc.uSaturate, saturate);
  sharedGl.uniform1f(loc.uBrightness, brightness);
  sharedGl.uniform1f(loc.uFrost, frost);
  sharedGl.uniform1f(loc.uEdgeBlur, edgeBlur);
  sharedGl.uniform1f(loc.uSS, SS);
  sharedGl.drawArrays(sharedGl.TRIANGLES, 0, 3);
  sharedGl.bindFramebuffer(sharedGl.FRAMEBUFFER, prevFb);
  return target;
}
