// Per-mask-region dual-shader beat visual (Task 11). Compiles ONE program from the beat's
// subject/background GLSL bodies (assembleRegionShaderSource), binds uTex0 = beat asset and
// uMask = the segmentation mask, and mixes the two regions by the mask channel. Renders full-frame
// as the app beat's content; chrome/captions composite on top exactly as a normal app beat
// (KinoVideo layers them above this in its own passes).
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
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "./runtime";
import type { RegionShaderProps, Theme } from "../../props.js";
import { assembleRegionShaderSource } from "../../shaderSource.js";
import { useFrameImageUrl } from "./media";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Manifest channel → uChannel dot-swizzle. gray masks carry coverage in r.
const CHANNEL_VEC: Record<RegionShaderProps["channel"], [number, number, number, number]> = {
  r: [1, 0, 0, 0],
  g: [0, 1, 0, 0],
  b: [0, 0, 1, 0],
  a: [0, 0, 0, 1],
  gray: [1, 0, 0, 0],
};

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
  frameVideo?: { lastUrl: string };
}

// A texture channel's source: a static image (loaded once) or a /vframes video (one <img> per frame).
interface Src {
  frameVideo: boolean;
  staticUrl: string; // used when !frameVideo
  frameUrl: string | null; // this-frame /vframes URL when frameVideo (may be null at init in sparse stills)
}

interface GLState {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  asset: Slot;
  mask: Slot;
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
      uploadTex(gl, unit, handle, await loadImage(src.frameUrl));
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    }
    slot = { handle, unit, frameVideo: { lastUrl: src.frameUrl ?? "" } };
  } else {
    uploadTex(gl, unit, handle, await loadImage(src.staticUrl));
    slot = { handle, unit };
  }
  if (samplerLoc) gl.uniform1i(samplerLoc, unit);
  return slot;
}

// Upload this frame's extracted <img> into a frame-video slot when the /vframes URL changed. No-op
// for static image slots and for repeat/absent URLs.
async function updateFrameSlot(gl: WebGL2RenderingContext, slot: Slot, url: string | null): Promise<void> {
  if (!slot.frameVideo || !url || url === slot.frameVideo.lastUrl) return;
  uploadTex(gl, slot.unit, slot.handle, await loadImage(url));
  slot.frameVideo.lastUrl = url;
}

// Compile the program + build both texture slots. Never rejects — failure resolves null (the beat
// keeps the night fill, same policy as a broken <Img>). Cached once per component via initRef.
async function initGL(canvas: HTMLCanvasElement, assetSrc: Src, maskSrc: Src, region: RegionShaderProps): Promise<GLState | null> {
  try {
    const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    const mk = (type: number, s: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, s);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("RegionShader compile failed:\n" + gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = mk(gl.VERTEX_SHADER, VERT);
    const fs = mk(gl.FRAGMENT_SHADER, assembleRegionShaderSource(region.subjectCode, region.backgroundCode, []));
    if (!vs || !fs) return null;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("RegionShader link failed:\n" + gl.getProgramInfoLog(prog));
      return null;
    }
    const loc: Record<string, WebGLUniformLocation | null> = {};
    for (const n of ["iResolution", "iTime", "iFrame", "iTimeDelta", "uTex0", "uMask", "uChannel"]) {
      loc[n] = gl.getUniformLocation(prog, n);
    }
    gl.useProgram(prog);
    const assetSlot = await makeSlot(gl, 0, assetSrc, loc.uTex0);
    const maskSlot = await makeSlot(gl, 1, maskSrc, loc.uMask);
    return { gl, prog, loc, asset: assetSlot, mask: maskSlot };
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
  maskSrc: Src,
  region: RegionShaderProps,
  frame: number,
  width: number,
  height: number,
): Promise<void> {
  try {
    initRef.current ??= initGL(canvas, assetSrc, maskSrc, region);
    const st = await initRef.current;
    if (!st) return;
    const { gl, prog, loc } = st;
    await updateFrameSlot(gl, st.asset, assetSrc.frameUrl);
    await updateFrameSlot(gl, st.mask, maskSrc.frameUrl);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    gl.uniform3f(loc.iResolution, width, height, 1);
    // ponytail: iTime/iTimeDelta stay on the 30fps convention (all kino comps are 30fps); the video
    // SOURCE frame above is picked node-side with the real fps, which is what must be exact.
    gl.uniform1f(loc.iTime, frame / 30);
    gl.uniform1i(loc.iFrame, frame);
    gl.uniform1f(loc.iTimeDelta, 1 / 30);
    const ch = CHANNEL_VEC[region.channel] ?? CHANNEL_VEC.gray;
    gl.uniform4f(loc.uChannel, ch[0], ch[1], ch[2], ch[3]);
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
  maskMediaKey?: string; // /vframes key when the mask is video (maskKind === "video")
}> = ({ asset, region, t, assetMediaKey, maskMediaKey }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const initRef = useRef<Promise<GLState | null> | null>(null);

  // Current-frame /vframes URLs for the video sources (null for static-image sources or un-extracted
  // sparse-still frames). Same lookup FrameVideo uses, so the GL texture tracks the identical frame.
  const assetSrc: Src = { frameVideo: !!assetMediaKey, staticUrl: staticFile(asset), frameUrl: useFrameImageUrl(assetMediaKey) };
  const maskSrc: Src = { frameVideo: !!maskMediaKey, staticUrl: staticFile(region.maskSrc), frameUrl: useFrameImageUrl(maskMediaKey) };

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    track(drawFrame(canvas, initRef, assetSrc, maskSrc, region, frame, width, height));
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
