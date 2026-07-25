// Per-mask-region dual-shader beat visual (Task 11). Compiles ONE program from the beat's
// subject/background GLSL bodies (assembleRegionShaderSource), binds uTex0 = beat asset and
// uMask0..N = the segmentation mask(s), and mixes the two regions by the union of their channels
// (RegionShaderProps.masks — usually 1 entry, up to MAX_REGION_MASKS for compositing several
// independently-segmented subjects onto one shared background). Renders full-frame as the app
// beat's content; chrome/captions composite on top exactly as a normal app beat (KinoVideo layers
// them above this in its own passes).
//
// VIDEO sources (mask.mp4, and a video beat asset) do NOT use a <video> element: <video> seeking
// never advances under kino's deterministic headless capture, so the split froze at frame 0. They
// route through the SAME node-side frame pipeline footage uses — videoFrames.ts pre-extracts one
// image per composition frame, served at /vframes; RegionShader draws the current frame's <img> into
// each GL texture (useFrameImageUrl picks the exact file, identical lookup to FrameVideo). Image
// sources load once and stay static.
//
// Determinism: the initial texture load and every per-frame image upload are registered on a module
// pending-set that kinoSeek drains (awaitRegionShaders) after flushSync — the same gate role
// settleImages plays for DOM <img>. So frame 0 is never the bare night fill.
import React, { useLayoutEffect, useRef } from "react";
import { reportFatal } from "./fatal";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "./runtime";
import type { BgParamValue, RegionShaderMask, RegionShaderProps, Theme } from "../../props.js";
import { assembleRegionShaderSource, MAX_REGION_MASKS, resolveUniforms, extraParamNames } from "../../shaderSource.js";
import { paramsAt } from "../../bgparams.js";
import { buildMotionVars } from "../../motionVars.js";
import { useFrameImageUrl } from "./media";
import { buildTemplate, rasterAt, scrubCss, TEX_ROOT, type HtmlTemplate } from "./bgTextures";
import { motionScrubCss, KINO_FILTERS } from "./motionCss";

// The alias set baked into the compiled program: `#define u_<name> uParamI`. Derived from the base
// params PLUS every keyframe so it is stable across frames — a per-frame resolved dict would drop
// keys and silently shift a slot out from under the baked-in aliases. One bank serves every body.
const regionExtras = (region: RegionShaderProps): string[] => extraParamNames(region.params ?? {}, region.keyframes ?? []);

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Manifest channel → uChannel dot-swizzle. gray masks carry coverage in r. An unbound slot (beyond
// region.masks.length) gets the zero vector so it never contributes to the union.
const CHANNEL_VEC: Record<RegionShaderMask["channel"], [number, number, number, number]> = {
  r: [1, 0, 0, 0],
  g: [0, 1, 0, 0],
  b: [0, 0, 1, 0],
  a: [0, 0, 0, 1],
  gray: [1, 0, 0, 0],
};
const ZERO_VEC: [number, number, number, number] = [0, 0, 0, 0];

// Render page must await these before capturing a frame: initial texture loads + per-frame image
// uploads. Mirrors settleImages for RegionShader's off-DOM Image() + WebGL output. Each entry
// removes itself on settle, so the set is empty once a frame's work completes.
const pending = new Set<Promise<void>>();
function track(p: Promise<void>): void {
  pending.add(p);
  void p.finally(() => pending.delete(p));
}
export function awaitRegionShaders(): Promise<void> {
  return Promise.all([...pending]).then(() => undefined);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("region shader asset failed to load: " + url));
  });
}

// One texture source. `frameVideo` present ⇒ animated: re-upload this frame's extracted <img> when
// the /vframes URL changes. `lastUrl` guards against re-decoding the same frame.
interface Slot {
  handle: WebGLTexture;
  unit: number;
  // Source pixel size, (0,0) until a real image lands. Only the backdrop slot's is uploaded (as
  // uTexSize1) - kinoCoverUV/kinoBackdrop read it and treat (0,0) as "no reframe", i.e. stretch.
  size: [number, number];
  frameVideo?: { lastUrl: string };
}

// A texture channel's source: a static image (loaded once) or a /vframes video (one <img> per frame).
interface Src {
  frameVideo: boolean;
  staticUrl: string; // used when !frameVideo
  frameUrl: string | null; // this-frame /vframes URL when frameVideo (may be null at init in sparse stills)
}

// An extra sampler channel (uTex1..uTex3). `tpl` present ⇒ a motion .html that re-rasterizes every
// frame at the beat's progress; `lastCss` is the raster identity (same CSS ⇒ same pixels ⇒ no work).
interface TexChannel {
  handle: WebGLTexture;
  unit: number;
  tpl?: HtmlTemplate;
  lastCss?: string;
}

interface GLState {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  asset: Slot;
  masks: Slot[]; // index 0..region.masks.length-1 are real sources; the rest are inert placeholders
  texes: TexChannel[]; // uTex1..uTex3; entries past region.textures.length are transparent placeholders
  backdrop: Slot | null; // the cutout's second source (uTex1), or null when the beat has no backdrop
}

// uTex0 is always the beat's own asset, so authored channels start at uTex1.
export const MAX_REGION_TEXTURES = 3;

// CSS for one frame of a motion-HTML channel. Everything the shadow-root surface gives a motion
// graphic, minus what only a live DOM layer can have (Lottie, per-frame procedural markup, triggers):
// the scrub stylesheet with its host block rebound to the raster's wrapper class, the frame-driven
// custom properties (--progress, the eased curves, the palette, each region param as --<name>), and
// the generic 1s-convention scrub for author @keyframes outside the kino classes.
function motionRasterCss(theme: Theme, params: Record<string, BgParamValue>, dyn: { frame: number; fps: number; progress: number; width: number; height: number }): string {
  const vars = buildMotionVars(theme, {
    frame: dyn.frame,
    t: dyn.fps > 0 ? dyn.frame / dyn.fps : 0,
    progress: dyn.progress,
    pulse: 0,
    params,
    fps: dyn.fps,
    width: dyn.width,
    height: dyn.height,
  });
  const decls = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `${scrubCss(dyn.progress)} ${motionScrubCss(`.${TEX_ROOT}`)} .${TEX_ROOT}{${decls}}`;
}

function uploadTex(gl: WebGL2RenderingContext, unit: number, handle: WebGLTexture, src: TexImageSource): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

// Create a texture on `unit`, wire filtering, and point `samplerLoc` at it. Image sources upload
// once here; frame-video sources upload this frame's <img> if extracted yet, else a 1×1 placeholder
// so the texture stays sample-complete (the real frame lands via updateFrameSlot before capture).
async function makeSlot(
  gl: WebGL2RenderingContext,
  unit: number,
  src: Src,
  samplerLoc: WebGLUniformLocation | null,
): Promise<Slot> {
  const handle = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let slot: Slot;
  if (src.frameVideo) {
    if (src.frameUrl) {
      const img = await loadImage(src.frameUrl);
      uploadTex(gl, unit, handle, img);
      slot = { handle, unit, size: [img.naturalWidth, img.naturalHeight], frameVideo: { lastUrl: src.frameUrl } };
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
      slot = { handle, unit, size: [0, 0], frameVideo: { lastUrl: "" } };
    }
  } else {
    const img = await loadImage(src.staticUrl);
    uploadTex(gl, unit, handle, img);
    slot = { handle, unit, size: [img.naturalWidth, img.naturalHeight] };
  }
  if (samplerLoc) gl.uniform1i(samplerLoc, unit);
  return slot;
}

// Inert 1×1 texture for a mask slot beyond region.masks.length — its uChannel is always the zero
// vector (see ZERO_VEC), so its content never contributes to the union; this just keeps every
// declared uMaskN sampler complete without fetching anything.
function makePlaceholderSlot(gl: WebGL2RenderingContext, unit: number, samplerLoc: WebGLUniformLocation | null): Slot {
  const handle = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  if (samplerLoc) gl.uniform1i(samplerLoc, unit);
  return { handle, unit, size: [0, 0] };
}

// Upload this frame's extracted <img> into a frame-video slot when the /vframes URL changed. No-op
// for static image slots and for repeat/absent URLs.
async function updateFrameSlot(gl: WebGL2RenderingContext, slot: Slot, url: string | null): Promise<void> {
  if (!slot.frameVideo || !url || url === slot.frameVideo.lastUrl) return;
  const img = await loadImage(url);
  uploadTex(gl, slot.unit, slot.handle, img);
  slot.size = [img.naturalWidth, img.naturalHeight];
  slot.frameVideo.lastUrl = url;
}

// Build the uTex1..uTex3 channels. An image uploads once, like any static source. A motion .html
// gets a template measured at COMPOSITION size (a full-frame graphic positions its children with
// inset:0 and would shrink-wrap to nothing under fit-content) at 1× (it is already authored at the
// size it renders), plus the kino SVG filter library so filter:url(#kino-grain) resolves inside the
// isolated SVG document. Channels the spec doesn't declare get a transparent 1×1 so every declared
// sampler stays complete and reads (0,0,0,0) — "unbound channels sample transparent black".
async function makeTexChannels(
  gl: WebGL2RenderingContext,
  region: RegionShaderProps,
  loc: Record<string, WebGLUniformLocation | null>,
  theme: Theme,
  width: number,
  height: number,
): Promise<TexChannel[]> {
  const defs = region.textures ?? [];
  const out: TexChannel[] = [];
  for (let i = 0; i < MAX_REGION_TEXTURES; i++) {
    const unit = MAX_REGION_MASKS + 1 + i; // 0 = asset, 1..MAX_REGION_MASKS = masks
    const samplerLoc = loc[`uTex${i + 1}`];
    const def = defs[i];
    if (def?.kind === "image" && def.src) {
      const slot = await makeSlot(gl, unit, { frameVideo: false, staticUrl: staticFile(def.src), frameUrl: null }, samplerLoc);
      out.push({ handle: slot.handle, unit: slot.unit });
    } else if (def?.kind === "html" && def.html) {
      const tpl = await buildTemplate(def.html, theme, { size: { w: width, h: height }, scale: 1, defs: KINO_FILTERS });
      // LINEAR, not the placeholder's NEAREST: a body that warps or offsets its lookup (refraction,
      // displacement) samples between texels and would otherwise get blocky edges.
      const handle = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, handle);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // Transparent until the first raster lands (updateTexChannel, same frame, before drawArrays).
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      if (samplerLoc) gl.uniform1i(samplerLoc, unit);
      out.push({ handle, unit, tpl });
    } else {
      out.push(makePlaceholderSlot(gl, unit, samplerLoc));
    }
  }
  return out;
}

// Re-rasterize a motion-HTML channel for this frame and upload it. Same CSS ⇒ same pixels, so a
// static graphic (or a repeated frame) skips both the raster and the upload. No cache: the scrub
// value moves every frame, so entries would only accumulate.
async function updateTexChannel(gl: WebGL2RenderingContext, ch: TexChannel, css: string): Promise<void> {
  if (!ch.tpl || css === ch.lastCss) return;
  const canvas = await rasterAt(ch.tpl, "", css, null);
  if (!canvas) return;
  uploadTex(gl, ch.unit, ch.handle, canvas);
  ch.lastCss = css;
}

// Free a superseded program and its textures. The canvas keeps ONE WebGL2 context (getContext
// returns the same object on every call), so a re-keyed component would otherwise leak a program
// and MAX_REGION_MASKS+1 textures per spec. Deletion is by object name and the new init has
// already bound its own handles, so this can't disturb the replacement.
function disposeGL(st: GLState | null): void {
  if (!st) return;
  st.gl.deleteProgram(st.prog);
  st.gl.deleteTexture(st.asset.handle);
  for (const m of st.masks) st.gl.deleteTexture(m.handle);
  for (const c of st.texes) st.gl.deleteTexture(c.handle);
  if (st.backdrop) st.gl.deleteTexture(st.backdrop.handle);
}

// Compile the program + build the asset slot and every mask slot (real sources first, inert
// placeholders for the rest). Never rejects — failure resolves null (the beat keeps the night
// fill, same policy as a broken <Img>). Cached in initRef, keyed by glKey (see the component).
async function initGL(
  canvas: HTMLCanvasElement,
  assetSrc: Src,
  maskSrcs: Src[],
  region: RegionShaderProps,
  theme: Theme,
  width: number,
  height: number,
  backdropSrc: Src | null,
): Promise<GLState | null> {
  try {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    // The subject and background bodies are concatenated into ONE translation unit (each
    // mainImage renamed), so a helper declared at file scope in both frags is a duplicate
    // definition here. That is the most common way to break a region shader, and the driver
    // cites a line in this assembled source — hence reporting it alongside the log.
    const fragSrc = assembleRegionShaderSource(
      region.subjectCode,
      region.backgroundCode,
      regionExtras(region),
      region.masks.map((m) => m.subjectCode ?? null),
      !!backdropSrc,
    );
    const mk = (type: number, s: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        reportFatal(
          `RegionShader ${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader failed to compile`,
          gl.getShaderInfoLog(sh),
          s,
        );
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
      reportFatal("RegionShader program failed to link", gl.getProgramInfoLog(prog), fragSrc);
      return null;
    }
    // Flagged for deletion, actually freed with the program — otherwise disposeGL leaves them behind.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    const loc: Record<string, WebGLUniformLocation | null> = {};
    // The colour/intensity/pulse uniforms are declared in the region header but were never uploaded,
    // so they all read 0 — which would make `params: { colorA: "#ff0000" }` silently render black.
    // Region shaders now carry the same param surface backgrounds do, so bind the same set.
    const names = ["iResolution", "iTime", "iFrame", "iTimeDelta", "uTex0", "uTex1", "uTexSize1",
                   "iMouse", "uPulse", "uColorA", "uColorB", "uColorC", "uIntensity",
                   "uParam0", "uParam1", "uParam2", "uParam3"];
    for (let i = 0; i < MAX_REGION_MASKS; i++) names.push(`uMask${i}`, `uChannel${i}`);
    for (let i = 1; i <= MAX_REGION_TEXTURES; i++) names.push(`uTex${i}`);
    for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
    gl.useProgram(prog);
    const assetSlot = await makeSlot(gl, 0, assetSrc, loc.uTex0);
    const masks: Slot[] = [];
    for (let i = 0; i < MAX_REGION_MASKS; i++) {
      const unit = i + 1; // unit 0 is the asset
      masks.push(
        i < maskSrcs.length ? await makeSlot(gl, unit, maskSrcs[i], loc[`uMask${i}`]) : makePlaceholderSlot(gl, unit, loc[`uMask${i}`]),
      );
    }
    const texes = await makeTexChannels(gl, region, loc, theme, width, height);
    // The cutout's backdrop, on the unit past the masks (0 = asset, 1..MAX_REGION_MASKS = masks).
    // uTexSize1 is the FIRST uTexSize this component has ever uploaded: kinoCoverUV/kinoBackdrop
    // read it and treat (0,0) as "no reframe", which would stretch an unrelated clip to the beat's
    // aspect. uTexSize0 is deliberately still not uploaded - doing so would silently switch every
    // existing spec that calls kinoBackdrop(uTex0, uTexSize0, ...) from stretch to cover-fit.
    let backdrop: Slot | null = null;
    if (backdropSrc) {
      backdrop = await makeSlot(gl, MAX_REGION_MASKS + 1, backdropSrc, loc.uTex1);
      gl.uniform2f(loc.uTexSize1, backdrop.size[0], backdrop.size[1]);
    }
    return { gl, prog, loc, asset: assetSlot, masks, texes, backdrop };
  } catch (err) {
    console.error(String(err));
    return null;
  }
}

// Per-frame render: ensure init (once), re-upload any video sources for this frame, draw. Registered
// on the pending set so kinoSeek awaits it. Never throws — a rejected promise would break the gate.
async function drawFrame(
  canvas: HTMLCanvasElement,
  initRef: React.MutableRefObject<Promise<GLState | null> | null>,
  assetSrc: Src,
  maskSrcs: Src[],
  region: RegionShaderProps,
  frame: number,
  width: number,
  height: number,
  fps: number,
  theme: Theme,
  durationFrames: number,
  backdropSrc: Src | null,
): Promise<void> {
  try {
    initRef.current ??= initGL(canvas, assetSrc, maskSrcs, region, theme, width, height, backdropSrc);
    const st = await initRef.current;
    if (!st) return;
    const { gl, prog, loc } = st;
    await updateFrameSlot(gl, st.asset, assetSrc.frameUrl);
    await Promise.all(maskSrcs.map((src, i) => updateFrameSlot(gl, st.masks[i], src.frameUrl)));
    if (st.backdrop && backdropSrc) await updateFrameSlot(gl, st.backdrop, backdropSrc.frameUrl);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    // iTime/iTimeDelta and every keyframe lookup run on the COMPOSITION's fps, read from
    // useVideoConfig — not a hardcoded 30. "All kino comps are 30fps" stopped being true when the
    // spec gained an `fps` field (1-120): on a 60fps comp a hardcoded 30 makes iTime advance at
    // twice real time, and since phase 3 it would land every keyframe at half its authored second.
    //
    // BEAT-RELATIVE clock: KinoVideo mounts this inside <Sequence from={beat start}>, and Sequence
    // rebases the frame context to 0 there — so `frame` (hence iTime and every keyframe lookup) is
    // already seconds-from-beat-start. Same idiom as zoomKeyframes/captionKeyframes: the track rides
    // real VO timing instead of breaking when a beat shifts, and the params share one clock with
    // iTime. See docs/superpowers/specs/2026-07-25-region-params-design.md.
    const resolved = paramsAt(region.params ?? {}, region.keyframes ?? [], fps > 0 ? frame / fps : 0);
    const u = resolveUniforms(resolved, { frame, fps, width, height, pulse: 0 }, regionExtras(region));
    // Motion-HTML channels re-raster on the beat's OWN progress, the same 0→1 a motionOverlay of the
    // identical markup would animate on — so the graphic reads the same whether it composites above
    // the beat or gets sampled inside it. The region params double as its --<name> CSS vars, so one
    // keyframe track drives the shader and the graphic together.
    if (st.texes.some((c) => c.tpl)) {
      const progress = durationFrames > 0 ? Math.min(1, Math.max(0, frame / durationFrames)) : 0;
      const css = motionRasterCss(theme, resolved, { frame, fps, progress, width, height });
      await Promise.all(st.texes.map((ch) => updateTexChannel(gl, ch, css)));
    }
    gl.uniform3f(loc.iResolution, width, height, 1);
    gl.uniform1f(loc.iTime, u.iTime);
    gl.uniform1i(loc.iFrame, u.iFrame);
    gl.uniform1f(loc.iTimeDelta, u.iTimeDelta);
    gl.uniform4f(loc.iMouse, 0, 0, 0, 0);
    // uPulse is declared in the region header but has no trigger surface this phase (YAGNI — nothing
    // needs a one-shot yet). Uploaded explicitly as 0 so a body referencing it reads a defined value;
    // when a one-shot appears, pulseAt(triggers, frame/30) drops in right here.
    gl.uniform1f(loc.uPulse, u.uPulse);
    gl.uniform3fv(loc.uColorA, u.uColorA);
    gl.uniform3fv(loc.uColorB, u.uColorB);
    gl.uniform3fv(loc.uColorC, u.uColorC);
    gl.uniform1f(loc.uIntensity, u.uIntensity);
    gl.uniform1f(loc.uParam0, u.uParams[0]);
    gl.uniform1f(loc.uParam1, u.uParams[1]);
    gl.uniform1f(loc.uParam2, u.uParams[2]);
    gl.uniform1f(loc.uParam3, u.uParams[3]);
    // Refreshed every frame, not just at init: a sparse still can build the backdrop slot before
    // its /vframes image exists, so the size only becomes known on the first real upload above.
    if (st.backdrop) gl.uniform2f(loc.uTexSize1, st.backdrop.size[0], st.backdrop.size[1]);
    for (let i = 0; i < MAX_REGION_MASKS; i++) {
      const m = region.masks[i];
      const ch = m ? CHANNEL_VEC[m.channel] ?? CHANNEL_VEC.gray : ZERO_VEC;
      gl.uniform4f(loc[`uChannel${i}`], ch[0], ch[1], ch[2], ch[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  } catch (err) {
    console.error(String(err));
  }
}

export const RegionShader: React.FC<{
  asset: string;
  region: RegionShaderProps;
  t: Theme;
  assetMediaKey?: string; // /vframes key when the beat asset is a video (else the asset is a static image)
  maskMediaKeys?: (string | undefined)[]; // one per region.masks entry; set when that mask's kind === "video"
  durationFrames?: number; // beat length — maps a motion-HTML texture channel's --progress 0→1, as MotionGraphic does
  backdropMediaKey?: string; // /vframes key when region.backdrop is a video (else it's a static image)
}> = ({ asset, region, t, assetMediaKey, maskMediaKeys, durationFrames = 0, backdropMediaKey }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const initRef = useRef<Promise<GLState | null> | null>(null);
  const keyRef = useRef<string | null>(null);

  // Current-frame /vframes URLs for the video sources (null for static-image sources or un-extracted
  // sparse-still frames). Same lookup FrameVideo uses, so the GL texture tracks the identical frame.
  // Fixed MAX_REGION_MASKS hook calls (rules of hooks) regardless of how many masks this beat has.
  const assetSrc: Src = { frameVideo: !!assetMediaKey, staticUrl: staticFile(asset), frameUrl: useFrameImageUrl(assetMediaKey) };
  /* eslint-disable react-hooks/rules-of-hooks */
  const maskFrameUrls: (string | null)[] = [];
  for (let i = 0; i < MAX_REGION_MASKS; i++) maskFrameUrls.push(useFrameImageUrl(maskMediaKeys?.[i]));
  /* eslint-enable react-hooks/rules-of-hooks */
  const maskSrcs: Src[] = region.masks.map((m, i) => ({
    frameVideo: m.maskKind === "video",
    staticUrl: staticFile(m.maskSrc),
    frameUrl: maskFrameUrls[i],
  }));
  // The cutout's second source. The hook runs unconditionally (rules of hooks); the Src is null when
  // this beat has no backdrop, which is what keeps the program byte-identical for everyone else.
  const backdropFrameUrl = useFrameImageUrl(backdropMediaKey);
  const backdropSrc: Src | null = region.backdrop
    ? { frameVideo: !!backdropMediaKey, staticUrl: staticFile(region.backdrop), frameUrl: backdropFrameUrl }
    : null;

  // Everything initGL bakes in: every GLSL body (the assembled program) and the texture sources
  // (built once into slots). Per-frame /vframes URLs are deliberately NOT here — those re-upload
  // through updateFrameSlot and must not rebuild the program.
  const glKey = [
    region.subjectCode,
    region.backgroundCode,
    // Per-mask bodies are baked into the program too — two specs differing ONLY in a masks[].subject
    // would otherwise reuse the first one's compiled shader (see render-region-reuse.test.ts).
    ...region.masks.map((m) => m.subjectCode ?? ""),
    // Param NAMES are baked in as `#define u_<name> uParamI`, so two specs differing only in their
    // param names must not share a compiled program (same trap as the per-mask bodies above).
    regionExtras(region).join(","),
    `${assetSrc.frameVideo}|${assetSrc.staticUrl}`,
    ...maskSrcs.map((s) => `${s.frameVideo}|${s.staticUrl}`),
    // Texture channels are built into slots by initGL too (an html channel measures + serializes
    // its template there), so a spec differing only in its textures must not reuse cached state.
    ...(region.textures ?? []).map((tex) => `${tex.kind}|${tex.src ?? tex.html?.length}`),
    // Whether a backdrop exists is baked into the program (the uBackdrop aliases and the background
    // passthrough), and its slot is built once at init - so it belongs in the key like the bodies.
    `${backdropSrc?.frameVideo}|${backdropSrc?.staticUrl}`,
  ].join(" ");

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Worker pages are cached and re-loaded for the NEXT spec, and React keeps this component
    // instance at the same tree position — so initRef outlives the program it describes. Without
    // this a second render in one process would draw the FIRST spec's shader (identical bytes out
    // of two different region bodies). Same guard ShaderBackground uses for its progRef.
    if (keyRef.current !== glKey) {
      keyRef.current = glKey;
      const stale = initRef.current;
      initRef.current = null;
      if (stale) void stale.then(disposeGL, () => {});
    }
    track(drawFrame(canvas, initRef, assetSrc, maskSrcs, region, frame, width, height, fps, t, durationFrames, backdropSrc));
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
