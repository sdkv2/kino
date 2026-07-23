// WebGL2 fullscreen-quad background (rung 1). Mirrors CanvasBackground's contract: a per-frame
// useLayoutEffect runs synchronously inside the flushSync seek, so the screenshot captures a
// completed frame. The program compiles once (ref-cached); each frame only resolves tweened params
// and sets uniforms. Motion is frame-derived (iTime = frame/fps) → deterministic.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "./runtime";
import type { Theme, BgParamValue, BgKeyframe, BgTrigger } from "../../props.js";
import { paramsAt, pulseAt } from "../../bgparams.js";
import { assembleShaderSource, resolveUniforms } from "../../shaderSource.js";
import { registerBackdrop } from "./liquidGlass";
import { getBgTextures } from "./bgTextures";
import { shaderSS } from "../shaderQuality.js";

const VERT = `#version 300 es
void main() {
  // gl_VertexID fullscreen triangle — no attributes/VBO.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Supersample: render backing store at SS×, CSS downscales. MSAA does nothing on a fullscreen
// quad — aliasing is in the fragment. Default SS=2 (4× cost); mock/KINO_SHADER_SSAA=1 for draft.

interface Program {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  texHandles: (WebGLTexture | null)[];
  texRevisions: number[];
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

  // Bind texture channels once — they are static for the whole render (loaded in kinoLoad).
  // Flip Y at upload so v=0 is the bottom row, matching fragCoord orientation.
  gl.useProgram(prog);
  const texes = getBgTextures();
  const texHandles: (WebGLTexture | null)[] = [null, null, null, null];
  const texRevisions = [-1, -1, -1, -1];
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  for (let i = 0; i < 4; i++) {
    const t = texes[i];
    const uTex = gl.getUniformLocation(prog, `uTex${i}`);
    const uSize = gl.getUniformLocation(prog, `uTexSize${i}`);
    const uFrames = gl.getUniformLocation(prog, `uTexFrames${i}`);
    const uGrid = gl.getUniformLocation(prog, `uTexGrid${i}`);
    if (!t) {
      if (uSize) gl.uniform2f(uSize, 0, 0);
      if (uFrames) gl.uniform1f(uFrames, 0);
      if (uGrid) gl.uniform2f(uGrid, 1, 1);
      continue;
    }
    const handle = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source as TexImageSource);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (uTex) gl.uniform1i(uTex, i);
    if (uSize) gl.uniform2f(uSize, t.width, t.height);
    if (uFrames) gl.uniform1f(uFrames, t.frames);
    if (uGrid) gl.uniform2f(uGrid, t.cols, t.rows);
    texHandles[i] = handle;
    texRevisions[i] = t.revision;
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  return { gl, prog, loc, texHandles, texRevisions };
}

// Re-upload live-scrub channels whose pixels changed since the last frame (revision bump from
// prepareBgTextures). Static/flipbook channels never re-upload.
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
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, t.source as TexImageSource);
    p.texRevisions[i] = t.revision;
  }
  if (flipped) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
}

export const ShaderBackground: React.FC<{
  shaderSrc: string;
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
  t: Theme;
}> = ({ shaderSrc, params, keyframes, triggers, t }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<Program | null>(null);
  const errRef = useRef<string | null>(null);

  // Intentional: re-runs every frame (frame-derived deps). NOT a missing-deps bug — do not add [].
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || errRef.current) return;
    if (!progRef.current) {
      const built = compile(canvas, assembleShaderSource(shaderSrc));
      if (typeof built === "string") {
        errRef.current = built;
        if (frame === 0) console.error("ShaderBackground compile failed:\n" + built);
        return;
      }
      progRef.current = built;
    }
    const { gl, prog, loc } = progRef.current;
    const tt = fps > 0 ? frame / fps : 0;
    // Render at the supersampled backing resolution; CSS scales the canvas back down to composition
    // size, so the shader sees SS× pixels (iResolution + viewport) and the screenshot captures the
    // downsampled, anti-aliased result.
    const SS = shaderSS();
    const W = width * SS, H = height * SS;
    const u = resolveUniforms(paramsAt(params, keyframes, tt), { frame, fps, width: W, height: H, pulse: pulseAt(triggers, tt) });

    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    syncLiveTextures(progRef.current);
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
    gl.finish(); // ensure the draw completes before the frame screenshot
    registerBackdrop(canvas, W, H); // let kino-glass mirrors refract this frame's pixels
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
