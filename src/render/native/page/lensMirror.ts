// Backdrop-sampling lens runtime: per-element mirror FBOs for `class="kino-lens"`.
// Material GLSL from props.lensShaders (default `liquid-glass` → assets-lib/effects/).
// Override per element with `data-lens="<id>"`. Silhouette: border-radius, svg.kino-lens-shape, --glass-path*.

import { peekBackdrop, type BackdropTexture } from "./backdrop.js";
import { rasterLensShapeMask, shapeSdfMax } from "./lensShape.js";
import { reportFatal } from "./fatal";
import { shaderSS } from "../shaderQuality.js";
import { DEFAULT_LENS_ID, LENS_SELECTOR } from "../../lensContract.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const UNIFORM_NAMES = [
  "uBg", "uShape", "uBgRect", "uIsFullBg", "uUseShape", "uSize", "uRadius", "uRadii", "uBand", "uStrength",
  "uChroma", "uProfile", "uFilm", "uSaturate", "uBrightness", "uFrost", "uEdgeBlur", "uSS", "uSdfMax",
  "uLayerPass", "uPageOrigin", "uLayerDevSize", "uDevScale",
] as const;

interface LensState {
  wrapper: HTMLDivElement;
  canvas: HTMLCanvasElement;
  stage: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  fragSrc: string;
  loc: Record<string, WebGLUniformLocation | null>;
  tex: WebGLTexture;
  shapeTex: WebGLTexture;
  w: number;
  h: number;
}

const pools = new WeakMap<ParentNode, Map<number, LensState>>();

/** Lens bounds in page space (float) — one measure per frame, shared by mirror + blit. */
export interface LensPageRect {
  relLeft: number;
  relTop: number;
  w: number;
  h: number;
}

export function lensPageRect(el: HTMLElement, hostRect: DOMRect): LensPageRect {
  const rect = el.getBoundingClientRect();
  return {
    relLeft: rect.left - hostRect.left,
    relTop: rect.top - hostRect.top,
    w: rect.width,
    h: rect.height,
  };
}

export function lensStackOrder(els: HTMLElement[]): HTMLElement[] {
  return [...els].sort((a, b) => {
    const za = parseInt(getComputedStyle(a).zIndex, 10);
    const zb = parseInt(getComputedStyle(b).zIndex, 10);
    const nza = Number.isFinite(za) ? za : 0;
    const nzb = Number.isFinite(zb) ? zb : 0;
    if (nza !== nzb) return nza - nzb;
    if (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
    return 0;
  });
}

function bindTex2D(gl: WebGL2RenderingContext, tex: WebGLTexture): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function lensIdFor(el: HTMLElement): string {
  const raw = el.getAttribute("data-lens")?.trim();
  return raw || DEFAULT_LENS_ID;
}

function fragForId(id: string, shaders: Record<string, string>): string {
  const src = shaders[id];
  if (!src) {
    reportFatal(
      `kino-lens material "${id}" missing`,
      `Known: ${Object.keys(shaders).join(", ") || "(none)"}. Add data-lens or ship assets-lib/effects/${id}.frag.`,
    );
    return "";
  }
  return src;
}

function fragFor(el: HTMLElement, shaders: Record<string, string>): string {
  return fragForId(lensIdFor(el), shaders);
}

function compileProgram(
  gl: WebGL2RenderingContext,
  fragSrc: string,
): { prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> } | null {
  const mk = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      reportFatal("kino-lens shader failed to compile", gl.getShaderInfoLog(sh), src);
      return null;
    }
    return sh;
  };
  const vs = mk(gl.VERTEX_SHADER, VERT);
  const fs = mk(gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    reportFatal("kino-lens program failed to link", gl.getProgramInfoLog(prog), fragSrc);
    return null;
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of UNIFORM_NAMES) loc[n] = gl.getUniformLocation(prog, n);
  return { prog, loc };
}

function makeState(fragSrc: string): LensState | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", {
    preserveDrawingBuffer: true,
    antialias: false,
    alpha: true,
    premultipliedAlpha: true,
  });
  if (!gl) return null;
  const compiled = compileProgram(gl, fragSrc);
  if (!compiled) return null;
  const tex = gl.createTexture()!;
  bindTex2D(gl, tex);
  const shapeTex = gl.createTexture()!;
  bindTex2D(gl, shapeTex);

  const wrapper = document.createElement("div");
  wrapper.className = "kino-lens-mirror";
  wrapper.setAttribute(
    "style",
    "position:absolute;inset:0;overflow:hidden;z-index:-1;pointer-events:none",
  );
  canvas.setAttribute("style", "width:100%;height:100%;display:block");
  wrapper.appendChild(canvas);
  const stage = document.createElement("canvas");
  return {
    wrapper,
    canvas,
    stage,
    gl,
    prog: compiled.prog,
    fragSrc,
    loc: compiled.loc,
    tex,
    shapeTex,
    w: 0,
    h: 0,
  };
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

/** Upload SDF mask as raw bytes — canvas texImage2D premultiplies and zeroes RGB at A=0. */
function uploadShapeMask(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const w = canvas.width;
  const h = canvas.height;
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  if (ctx) {
    const data = ctx.getImageData(0, 0, w, h).data;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

function cssCornerRadii(cs: CSSStyleDeclaration, w: number, h: number): [number, number, number, number] {
  const cap = Math.min(w, h) / 2;
  const read = (raw: string) => Math.min(Math.max(0, parseFloat(raw) || 0), cap);
  return [
    read(cs.borderTopLeftRadius),
    read(cs.borderTopRightRadius),
    read(cs.borderBottomRightRadius),
    read(cs.borderBottomLeftRadius),
  ];
}

export interface LensMaterial {
  radius: number;
  radii: [number, number, number, number];
  strength: number;
  band: number;
  chroma: number;
  profile: number;
  film: [number, number, number, number];
  saturate: number;
  brightness: number;
  frost: number;
  edgeBlur: number;
}

function readLensMaterial(el: HTMLElement, w: number, h: number): LensMaterial {
  const cs = getComputedStyle(el);
  const radii = cssCornerRadii(cs, w, h);
  const radius = Math.max(radii[0], radii[1], radii[2], radii[3]);
  return {
    radius,
    radii,
    strength: cssVarPx(el, "--glass-strength", 26),
    band: cssVarPx(el, "--glass-band", Math.max(radius, 48)),
    chroma: cssVar(cs, "--glass-chroma", 0.07),
    profile: cssVar(cs, "--glass-profile", 2.2),
    film: cssColor(cs.getPropertyValue("--glass-film"), [1, 1, 1, 0.13]),
    saturate: cssVar(cs, "--glass-saturate", 1.25),
    brightness: cssVar(cs, "--glass-brightness", 1.06),
    frost: cssVarPx(el, "--glass-frost", 0),
    edgeBlur: cssVarPx(el, "--glass-edge-blur", 0),
  };
}

/** Scrape layout-time lens material + shape mask from a live element. */
export function scrapeLensLayout(el: HTMLElement): {
  lensId: string;
  material: LensMaterial;
  localW: number;
  localH: number;
  shapeMask: HTMLCanvasElement | null;
  sdfMax: number;
} {
  const rect = el.getBoundingClientRect();
  const localW = Math.max(4, Math.ceil(rect.width));
  const localH = Math.max(4, Math.ceil(rect.height));
  const SS = shaderSS();
  const shapeMask = rasterLensShapeMask(el, localW, localH, SS);
  return {
    lensId: lensIdFor(el),
    material: readLensMaterial(el, localW, localH),
    localW,
    localH,
    shapeMask,
    sdfMax: shapeMask ? shapeSdfMax(localW, localH) : 0,
  };
}

function applyLensMaterialUniforms(
  gl: WebGL2RenderingContext,
  loc: Record<string, WebGLUniformLocation | null>,
  material: LensMaterial,
  w: number,
  h: number,
  SS: number,
  shapeMask: HTMLCanvasElement | null,
  sdfMax: number,
): void {
  gl.uniform2f(loc.uSize, w, h);
  gl.uniform1f(loc.uRadius, material.radius);
  gl.uniform4f(loc.uRadii, material.radii[0], material.radii[1], material.radii[2], material.radii[3]);
  gl.uniform1f(loc.uBand, material.band);
  gl.uniform1f(loc.uStrength, material.strength);
  gl.uniform1f(loc.uChroma, material.chroma);
  gl.uniform1f(loc.uProfile, material.profile);
  gl.uniform4f(loc.uFilm, material.film[0], material.film[1], material.film[2], material.film[3]);
  gl.uniform1f(loc.uSaturate, material.saturate);
  gl.uniform1f(loc.uBrightness, material.brightness);
  gl.uniform1f(loc.uFrost, material.frost);
  gl.uniform1f(loc.uEdgeBlur, material.edgeBlur);
  gl.uniform1f(loc.uSS, SS);
  gl.uniform1f(loc.uUseShape, shapeMask ? 1.0 : 0.0);
  gl.uniform1f(loc.uSdfMax, shapeMask ? sdfMax : 0.0);
}

function setLensUniforms(
  gl: WebGL2RenderingContext,
  loc: Record<string, WebGLUniformLocation | null>,
  el: HTMLElement,
  w: number,
  h: number,
  SS: number,
): HTMLCanvasElement | null {
  const scraped = scrapeLensLayout(el);
  applyLensMaterialUniforms(gl, loc, scraped.material, w, h, SS, scraped.shapeMask, scraped.sdfMax);
  return scraped.shapeMask;
}

/** Render lens refraction mirrors (canvas backdrop path — non-compositor / multi-fallback). */
export function applyLensMirrors(
  root: ParentNode | null,
  opts?: { elements?: HTMLElement[]; lensShaders?: Record<string, string> },
): void {
  if (!root) return;
  const shaders = opts?.lensShaders;
  if (!shaders || Object.keys(shaders).length === 0) {
    reportFatal("kino-lens materials missing", "props.lensShaders empty — hydrate via effectsLib / resolveMotionGraphic");
    return;
  }
  const allEls = root.querySelectorAll<HTMLElement>(LENS_SELECTOR);
  const els = opts?.elements ?? Array.from(allEls);
  if (els.length === 0) return;

  const backdrop = peekBackdrop();
  if (!backdrop) return;

  let pool = pools.get(root);
  if (!pool) {
    pool = new Map();
    pools.set(root, pool);
  }
  const hostBox =
    root instanceof ShadowRoot
      ? (root.host as HTMLElement | undefined)?.getBoundingClientRect()
      : root instanceof HTMLElement
        ? root.getBoundingClientRect()
        : undefined;
  const pageW = hostBox?.width || backdrop.width || window.innerWidth;
  const pageH = hostBox?.height || backdrop.height || window.innerHeight;
  const scaleX = backdrop.width / pageW;
  const scaleY = backdrop.height / pageH;

  els.forEach((el) => {
    const i = Array.prototype.indexOf.call(allEls, el);
    if (i < 0) return;
    const fragSrc = fragFor(el, shaders);
    if (!fragSrc) return;

    let state = pool!.get(i);
    if (!state || state.fragSrc !== fragSrc) {
      state = makeState(fragSrc) ?? undefined;
      if (!state) return;
      pool!.set(i, state);
    }

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

    const hr =
      root instanceof ShadowRoot
        ? ((root.host as HTMLElement | undefined)?.getBoundingClientRect() ?? { left: 0, top: 0 })
        : root instanceof HTMLElement
          ? root.getBoundingClientRect()
          : { left: 0, top: 0 };
    const relLeft = rect.left - hr.left;
    const relTop = rect.top - hr.top;

    const sctx = stage.getContext("2d");
    if (!sctx) return;
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(backdrop.source, relLeft * scaleX, relTop * scaleY, w * scaleX, h * scaleY, 0, 0, w, h);

    gl.viewport(0, 0, w * SS, h * SS);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, stage);
    gl.uniform1f(loc.uIsFullBg, 0.0);
    gl.uniform4f(loc.uBgRect, 0, 0, 1, 1);
    gl.uniform1f(loc.uLayerPass, 0.0);
    gl.uniform1i(loc.uBg, 0);
    const shapeMask = setLensUniforms(gl, loc, el, w, h, SS);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shapeTex);
    if (shapeMask) uploadShapeMask(gl, shapeMask);
    gl.uniform1i(loc.uShape, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  });
}

interface SharedLensProgram {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  shapeTex: WebGLTexture;
  fragSrc: string;
}

const sharedPrograms = new WeakMap<WebGL2RenderingContext, Map<string, SharedLensProgram | null>>();

function sharedLensProgram(gl: WebGL2RenderingContext, fragSrc: string): SharedLensProgram | null {
  let bySrc = sharedPrograms.get(gl);
  if (!bySrc) {
    bySrc = new Map();
    sharedPrograms.set(gl, bySrc);
  }
  if (bySrc.has(fragSrc)) return bySrc.get(fragSrc)!;
  const compiled = compileProgram(gl, fragSrc);
  let entry: SharedLensProgram | null = null;
  if (compiled) {
    const shapeTex = gl.createTexture()!;
    bindTex2D(gl, shapeTex);
    entry = { prog: compiled.prog, loc: compiled.loc, shapeTex, fragSrc };
  }
  bySrc.set(fragSrc, entry);
  return entry;
}

export interface BakedLensPass {
  lensId: string;
  material: LensMaterial;
  pageRect: LensPageRect;
  localW: number;
  localH: number;
  shapeMask: HTMLCanvasElement | null;
  sdfMax: number;
}

/**
 * Caller must bind the destination FBO and enable premultiplied src-over blending.
 */
export function drawLensLayerPassEntry(
  gl: WebGL2RenderingContext,
  backdrop: Readonly<BackdropTexture>,
  entry: BakedLensPass,
  pageW: number,
  pageH: number,
  layerDevW: number,
  layerDevH: number,
  lensShaders: Record<string, string>,
): boolean {
  const fragSrc = fragForId(entry.lensId, lensShaders);
  if (!fragSrc) return false;
  const program = sharedLensProgram(gl, fragSrc);
  if (!program) return false;

  const { relLeft, relTop, w, h } = entry.pageRect;
  if (w < 4 || h < 4) return false;

  const SS = shaderSS();
  const devScale = pageW > 0 ? layerDevW / pageW : 1;
  const { prog, loc, shapeTex } = program;

  gl.viewport(0, 0, layerDevW, layerDevH);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
  gl.uniform1f(loc.uIsFullBg, 1.0);
  gl.uniform4f(
    loc.uBgRect,
    relLeft / pageW,
    (pageH - relTop - h) / pageH,
    w / pageW,
    h / pageH,
  );
  gl.uniform1i(loc.uBg, 0);
  gl.uniform1f(loc.uLayerPass, 1.0);
  gl.uniform2f(loc.uPageOrigin, relLeft, relTop);
  gl.uniform2f(loc.uLayerDevSize, layerDevW, layerDevH);
  gl.uniform1f(loc.uDevScale, devScale);
  applyLensMaterialUniforms(
    gl,
    loc,
    entry.material,
    entry.localW,
    entry.localH,
    SS,
    entry.shapeMask,
    entry.sdfMax,
  );
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, shapeTex);
  if (entry.shapeMask) uploadShapeMask(gl, entry.shapeMask);
  gl.uniform1i(loc.uShape, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return true;
}
