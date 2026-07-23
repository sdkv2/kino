// WebGL2 fullscreen-quad background (rung 1). Mirrors CanvasBackground's contract: a per-frame
// useLayoutEffect runs synchronously inside the flushSync seek, so the screenshot captures a
// completed frame. The program compiles once (ref-cached); each frame only resolves tweened params
// and sets uniforms. Motion is frame-derived (iTime = frame/fps) → deterministic.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "./runtime";
import type { Theme, BgParamValue, BgKeyframe, BgTrigger } from "../../props.js";
import { paramsAt, pulseAt } from "../../bgparams.js";
import { assembleShaderSource, resolveUniforms } from "../../shaderSource.js";

const VERT = `#version 300 es
void main() {
  // gl_VertexID fullscreen triangle — no attributes/VBO.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

interface Program {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
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
  return { gl, prog, loc };
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
    const u = resolveUniforms(paramsAt(params, keyframes, tt), { frame, fps, width, height, pulse: pulseAt(triggers, tt) });

    gl.viewport(0, 0, width, height);
    gl.useProgram(prog);
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
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} width={width} height={height} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
