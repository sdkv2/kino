// Liquid-glass runtime: true per-pixel edge refraction for motion-graphic elements tagged
// `class="kino-glass"`. Chromium's compositor cannot run feImage displacement maps inside
// backdrop-filter (they degrade to a uniform white-map shift — see docs/motion-graphics.md),
// so this sidesteps backdrop-filter entirely: each frame the background canvas region behind
// the element is copied into a per-element WebGL mirror whose fragment shader computes an SDF
// lens (rounded-rect / circle / triangle, morphable) — displacement + blur at the rim,
// frosted body, per-channel chromatic dispersion, luminous film — Apple Liquid Glass material.
//
// Everything is synchronous inside the flushSync seek (texImage2D + drawArrays + finish),
// so captures stay deterministic: no feImage, no async image decode, no wall clock.
//
// Author contract (motion HTML): add `kino-glass` to a positioned element (keep background
// transparent — film lives in the mirror). Optional knobs, read from computed style each frame
// (tweenable via params/keyframes):
//   --glass-strength   max rim displacement in px            (default 26)
//   --glass-band       rim band width in px                  (default max(radius, 48))
//   --glass-chroma     RGB dispersion spread, 0..~0.2        (default 0.07)
//   --glass-profile    lens falloff exponent                 (default 2.2)
//   --glass-film       film color over the refraction        (default rgba(255,255,255,0.13))
//   --glass-saturate   backdrop saturation boost             (default 1.25)
//   --glass-brightness backdrop brightness boost             (default 1.06)
//   --glass-frost      body frost blur radius in px          (default 0)
//   --glass-edge-blur  extra blur at the rim in px           (default 0)
//   --glass-morph      continuum: 0=tri → 1=circ → 2=rect (default 2);
//                      pair mode (--glass-from ≥ 0): 0..1 blend from→to
//   --glass-from       optional shape id 0|1|2; ≥0 enables direct pair morph
//   --glass-to         pair-mode target shape id 0|1|2       (default 2)
//   --glass-tilt       SDF rotation in degrees               (default 0; element stays unrotated)
// Supersample (SS) comes from render-config / window.__kinoShaderSS (mock defaults to 1).

import { shaderSS } from "../shaderQuality.js";

interface Backdrop {
  source: CanvasImageSource;
  width: number; // backing pixels
  height: number;
}

let backdrop: Backdrop | null = null;

/** Called by background layers each frame after they draw. Idempotent. */
export function registerBackdrop(source: CanvasImageSource, width: number, height: number): void {
  backdrop = { source, width, height };
}

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform vec2 uSize;        // element size in css px
uniform float uRadius;     // border radius px (round-rect corner)
uniform float uBand;       // rim band width px
uniform float uStrength;   // max displacement px
uniform float uChroma;     // per-channel spread
uniform float uProfile;    // falloff exponent
uniform vec4 uFilm;        // film rgba (straight alpha)
uniform float uSaturate;
uniform float uBrightness;
uniform float uFrost;      // body frost blur px
uniform float uEdgeBlur;   // extra rim blur px
uniform float uMorph;      // continuum 0..2, or 0..1 blend when uMorphFrom >= 0
uniform float uMorphFrom;  // <0 = continuum; else discrete shape id 0|1|2
uniform float uMorphTo;    // pair-mode target shape id 0|1|2
uniform float uTilt;       // radians
uniform float uSS;         // supersample factor
out vec4 outColor;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// IQ-style SDFs: positive outside, negative inside. center = element-space midpoint.
float sdRoundRect(vec2 p, vec2 center, vec2 half_, float r) {
  vec2 c = p - center;
  vec2 q = abs(c) - (half_ - vec2(r));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float sdCircle(vec2 p, vec2 center, float r) {
  return length(p - center) - r;
}

// Isosceles triangle pointing up, fitted inside half_ extents around center.
float sdTriangle(vec2 p, vec2 center, vec2 half_) {
  vec2 q = p - center;
  float r = min(half_.x, half_.y) * 0.72;
  float k = sqrt(3.0);
  q.x = abs(q.x) - r;
  q.y = q.y + r / k;
  if (q.x + k * q.y > 0.0) q = vec2(q.x - k * q.y, -k * q.x - q.y) / 2.0;
  q.x -= clamp(q.x, -2.0 * r, 0.0);
  return -length(q) * sign(q.y);
}

float shapeSd(vec2 p) {
  // Constant fit (worst-case 45° AABB), not angle-dependent — dynamic tiltFit made full
  // spins pulse/shrink every quarter turn. Soft SDF + pad keep the rim off the canvas edge.
  float fit = 0.70;
  float pad = 8.0;
  vec2 center = 0.5 * uSize;
  vec2 half_ = max(center * fit - vec2(pad), vec2(8.0));
  float rRect = min(uRadius, min(half_.x, half_.y));
  float rCirc = min(half_.x, half_.y);
  float dTri = sdTriangle(p, center, half_);
  float dCirc = sdCircle(p, center, rCirc);
  float dRect = sdRoundRect(p, center, half_, rRect);
  // Pair morph (--glass-from ≥ 0): blend two discrete shapes so rect↔tri skips circle.
  if (uMorphFrom >= 0.0) {
    float a = floor(clamp(uMorphFrom, 0.0, 2.0) + 0.5);
    float b = floor(clamp(uMorphTo, 0.0, 2.0) + 0.5);
    float dA = a < 0.5 ? dTri : (a < 1.5 ? dCirc : dRect);
    float dB = b < 0.5 ? dTri : (b < 1.5 ? dCirc : dRect);
    // Smoothstep the blend — linear mix reads as two stacked silhouettes mid-way.
    float t = clamp(uMorph, 0.0, 1.0);
    t = t * t * (3.0 - 2.0 * t);
    return mix(dA, dB, t);
  }
  float m = clamp(uMorph, 0.0, 2.0);
  if (m < 1.0) return mix(dTri, dCirc, m);
  return mix(dCirc, dRect, m - 1.0);
}

vec3 sampleBg(vec2 px) {
  vec2 uv = px / uSize;
  return texture(uBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

// 17-tap disk blur — readable frost + soft rim (no extra FBO).
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
  vec2 half_ = 0.5 * uSize;
  // Tilt the SDF in local space; backdrop samples stay in element AABB (no CSS rotate).
  vec2 pl = half_ + rot2(uTilt) * (px - half_);

  float sd = shapeSd(pl);          // + outside, − inside
  float d = -sd;                   // inside distance, ≥0 inside
  // Softer outer falloff — frosted glass edge, not a hard cut.
  float alpha = smoothstep(-3.5, 2.5, d);
  if (alpha < 0.004) {
    outColor = vec4(0.0);
    return;
  }

  // Outward gradient via central differences on the tilted SDF.
  vec2 e = vec2(1.2, 0.0);
  vec2 grad = normalize(vec2(
    shapeSd(pl + e.xy) - shapeSd(pl - e.xy),
    shapeSd(pl + e.yx) - shapeSd(pl - e.yx)));

  float edgeU = clamp(1.0 - d / max(uBand, 1.0), 0.0, 1.0); // 1 at rim, 0 deep inside
  float f = pow(edgeU, uProfile) * uStrength;
  float blurR = uFrost * (0.55 + 0.45 * (1.0 - edgeU * 0.35)) + edgeU * edgeU * uEdgeBlur;

  // Refract + frost: chroma split around the blurred sample center.
  vec2 base = px - grad * f;
  vec3 col = vec3(
    sampleBgBlur(base - grad * (f * uChroma), blurR).r,
    sampleBgBlur(base, blurR).g,
    sampleBgBlur(base + grad * (f * uChroma), blurR).b);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturate) * uBrightness;
  // Frost haze — slight desat + milky lift in the body (reads as etched glass).
  float frostAmt = clamp(uFrost / 28.0, 0.0, 1.0) * (1.0 - edgeU * 0.5);
  col = mix(col, vec3(luma), frostAmt * 0.28);
  col = mix(col, vec3(0.92, 0.95, 1.0), frostAmt * 0.12);
  col = mix(col, uFilm.rgb, uFilm.a);

  // Soft lit rim — keep thin when frosted so edge blur reads, not a hard white stroke.
  float rim = exp(-d * d / max(uBand * 0.5 + uEdgeBlur * 0.25, 1.0)) * (0.22 - 0.08 * clamp(uEdgeBlur / 64.0, 0.0, 1.0));
  col += vec3(1.0) * max(rim, 0.0);

  outColor = vec4(col * alpha, alpha); // premultiplied for ONE / ONE_MINUS_SRC_ALPHA
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
  w: number;
  h: number;
}

// Pool per shadow root, keyed by glass-element index: Tier-2 sources replace the shadow's
// innerHTML every frame, which would otherwise churn a fresh WebGL context per frame per
// element (Chromium caps live contexts). Re-parenting a pooled <canvas> keeps its context.
const pools = new WeakMap<ShadowRoot, Map<number, GlassState>>();

function makeState(): GlassState | null {
  const canvas = document.createElement("canvas");
  // alpha:true so SDF outside can be transparent (morph shapes / soft edge)
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
      console.error("kino-glass shader compile failed:", gl.getShaderInfoLog(sh));
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
    console.error("kino-glass program link failed:", gl.getProgramInfoLog(prog));
    return null;
  }
  const names = [
    "uBg",
    "uSize",
    "uRadius",
    "uBand",
    "uStrength",
    "uChroma",
    "uProfile",
    "uFilm",
    "uSaturate",
    "uBrightness",
    "uFrost",
    "uEdgeBlur",
    "uMorph",
    "uMorphFrom",
    "uMorphTo",
    "uTilt",
    "uSS",
  ];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const wrapper = document.createElement("div");
  wrapper.className = "kino-glass-mirror";
  // No border-radius clip — silhouette comes from SDF alpha (needed for circle/triangle morph).
  wrapper.setAttribute(
    "style",
    "position:absolute;inset:0;overflow:hidden;z-index:-1;pointer-events:none",
  );
  canvas.setAttribute("style", "width:100%;height:100%;display:block");
  wrapper.appendChild(canvas);
  const stage = document.createElement("canvas");
  return { wrapper, canvas, stage, gl, prog, loc, tex, w: 0, h: 0 };
}

function cssVar(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const v = parseFloat(style.getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** Resolve a length custom property that may be `calc()`/`var()` to CSS px. */
function cssVarPx(el: HTMLElement, name: string, fallback: number): number {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (/^-?[\d.]+(px)?$/i.test(raw)) {
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }
  // Apply as width so the engine resolves calc()/var() to used px.
  const prev = el.style.width;
  el.style.width = raw;
  const px = parseFloat(getComputedStyle(el).width);
  if (prev) el.style.width = prev;
  else el.style.removeProperty("width");
  return Number.isFinite(px) ? px : fallback;
}

// Parse any CSS color via a 1px canvas roundtrip (deterministic; cached).
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
  colorCtx.fillStyle = s; // invalid values keep previous → detected below only loosely; fine for config
  colorCtx.fillRect(0, 0, 1, 1);
  const d = colorCtx.getImageData(0, 0, 1, 1).data;
  const out: [number, number, number, number] = [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  colorCache.set(s, out);
  return out;
}

/**
 * Find `.kino-glass` elements in a motion shadow root and render their refraction mirrors
 * for the current frame. Call once per frame after the background layer has drawn.
 */
export function applyLiquidGlass(root: ShadowRoot | null): void {
  if (!root) return;
  const els = root.querySelectorAll<HTMLElement>(".kino-glass");
  if (els.length === 0) return;
  if (!backdrop) return; // no canvas-backed background (e.g. overlay on avatar/app) — skip gracefully

  let pool = pools.get(root);
  if (!pool) {
    pool = new Map();
    pools.set(root, pool);
  }
  const pageW = window.innerWidth;
  const pageH = window.innerHeight;
  const scaleX = backdrop.width / pageW;
  const scaleY = backdrop.height / pageH;

  els.forEach((el, i) => {
    const state = pool!.get(i) ?? makeState();
    if (!state) return;
    pool!.set(i, state);

    if (state.wrapper.parentElement !== el) {
      el.insertBefore(state.wrapper, el.firstChild);
    }
    const cs = getComputedStyle(el);
    if (cs.position === "static") el.style.position = "relative";
    if (cs.isolation !== "isolate") el.style.isolation = "isolate"; // keep the z:-1 mirror inside this element

    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 4 || h < 4) return;

    const { gl, canvas, stage, prog, loc, tex } = state;
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

    // Snapshot the background region behind the element (source backing px → element px).
    const sctx = stage.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(backdrop!.source, rect.left * scaleX, rect.top * scaleY, w * scaleX, h * scaleY, 0, 0, w, h);

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
    const morph = cssVar(cs, "--glass-morph", 2); // default round-rect = prior behavior
    const morphFrom = cssVar(cs, "--glass-from", -1); // <0 = continuum mode
    const morphTo = cssVar(cs, "--glass-to", 2);
    const tiltDeg = cssVar(cs, "--glass-tilt", 0);
    const tilt = (tiltDeg * Math.PI) / 180;

    gl.viewport(0, 0, w * SS, h * SS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);
    gl.uniform1i(loc.uBg, 0);
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
    gl.uniform1f(loc.uMorph, morph);
    gl.uniform1f(loc.uMorphFrom, morphFrom);
    gl.uniform1f(loc.uMorphTo, morphTo);
    gl.uniform1f(loc.uTilt, tilt);
    gl.uniform1f(loc.uSS, SS);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish(); // complete before the frame screenshot
  });
}
