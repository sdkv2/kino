// Per-mask-region dual-shader beat visual (Task 11). Compiles ONE program from the beat's
// subject/background GLSL bodies (assembleRegionShaderSource), binds uTex0 = beat asset and
// uMask = the segmentation mask, and mixes the two regions by the mask channel. Renders full-frame
// as the app beat's content; chrome/captions composite on top exactly as a normal app beat
// (KinoVideo layers them above this in its own passes).
//
// Determinism: the initial texture load and every per-frame video seek are registered on a module
// pending-set that kinoSeek drains (awaitRegionShaders) after flushSync — the same gate role
// settleImages plays for DOM <img>. So frame 0 is never the bare night fill, and a video asset/mask
// re-seeks to frame/fps and re-uploads every frame (reusing the T6 bgTextures video path:
// loadVideo/seekVideo/videoTexStep). Image sources load once and stay static.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "./runtime";
import type { RegionShaderProps, Theme } from "../../props.js";
import { assembleRegionShaderSource } from "../../shaderSource.js";
import { loadVideo, seekVideo, videoTexStep } from "./bgTextures.js";

const VIDEO_EXT = /\.(mp4|mov|webm|mkv)$/i;

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

// Render page must await these before capturing a frame: initial texture loads + per-frame video
// seeks. Mirrors settleImages for RegionShader's off-DOM Image()/<video> + WebGL output. Each entry
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

// One bound texture unit. `video` present ⇒ animated: re-seek + re-draw + re-upload each frame.
interface Slot {
  handle: WebGLTexture;
  unit: number;
  video?: HTMLVideoElement;
  canvas?: HTMLCanvasElement;
  ctx?: CanvasRenderingContext2D;
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

// Create a texture on `unit`, wire filtering, load the source (image once / video first frame),
// upload it, and point `samplerLoc` at the unit. Video slots carry the <video>+canvas for re-seeks.
async function makeSlot(
  gl: WebGL2RenderingContext,
  unit: number,
  url: string,
  isVideo: boolean,
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
  if (isVideo) {
    const video = await loadVideo(url);
    const w = video.videoWidth || 2;
    const h = video.videoHeight || 2;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, w, h); // frame 0; per-frame seeks in updateVideoSlot
    uploadTex(gl, unit, handle, canvas);
    slot = { handle, unit, video, canvas, ctx };
  } else {
    uploadTex(gl, unit, handle, await loadImage(url));
    slot = { handle, unit };
  }
  if (samplerLoc) gl.uniform1i(samplerLoc, unit);
  return slot;
}

// Seek a video slot to this frame's source time (frame/fps) and re-upload. No-op for image slots.
async function updateVideoSlot(gl: WebGL2RenderingContext, slot: Slot, frame: number, fps: number): Promise<void> {
  if (!slot.video || !slot.ctx || !slot.canvas) return;
  const { time } = videoTexStep(frame, fps, 0);
  await seekVideo(slot.video, time);
  slot.ctx.drawImage(slot.video, 0, 0, slot.canvas.width, slot.canvas.height);
  uploadTex(gl, slot.unit, slot.handle, slot.canvas);
}

// Compile the program + build both texture slots. Never rejects — failure resolves null (the beat
// keeps the night fill, same policy as a broken <Img>). Cached once per component via initRef.
async function initGL(canvas: HTMLCanvasElement, asset: string, region: RegionShaderProps): Promise<GLState | null> {
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
    const assetSlot = await makeSlot(gl, 0, staticFile(asset), VIDEO_EXT.test(asset), loc.uTex0);
    const maskSlot = await makeSlot(gl, 1, staticFile(region.maskSrc), region.maskKind === "video", loc.uMask);
    return { gl, prog, loc, asset: assetSlot, mask: maskSlot };
  } catch (err) {
    console.error(String(err));
    return null;
  }
}

// Per-frame render: ensure init (once), re-seek any video sources for this frame, draw. Registered
// on the pending set so kinoSeek awaits it. Never throws — a rejected promise would break the gate.
async function drawFrame(
  canvas: HTMLCanvasElement,
  initRef: React.MutableRefObject<Promise<GLState | null> | null>,
  asset: string,
  region: RegionShaderProps,
  frame: number,
  fps: number,
  width: number,
  height: number,
): Promise<void> {
  try {
    initRef.current ??= initGL(canvas, asset, region);
    const st = await initRef.current;
    if (!st) return;
    const { gl, prog, loc } = st;
    await updateVideoSlot(gl, st.asset, frame, fps);
    await updateVideoSlot(gl, st.mask, frame, fps);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
    gl.uniform3f(loc.iResolution, width, height, 1);
    // ponytail: iTime/iTimeDelta stay on the 30fps convention (all kino comps are 30fps); the video
    // SOURCE seek above uses the real fps via videoTexStep, which is what must be exact.
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

export const RegionShader: React.FC<{ asset: string; region: RegionShaderProps; t: Theme }> = ({ asset, region, t }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const initRef = useRef<Promise<GLState | null> | null>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    track(drawFrame(canvas, initRef, asset, region, frame, fps, width, height));
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
