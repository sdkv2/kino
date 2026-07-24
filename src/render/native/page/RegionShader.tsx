// Per-mask-region dual-shader beat visual (Task 11). Compiles ONE program from the beat's
// subject/background GLSL bodies (assembleRegionShaderSource), binds uTex0 = beat asset and
// uMask = the segmentation mask, and mixes the two regions by the mask channel. Renders full-frame
// as the app beat's content; chrome/captions composite on top exactly as a normal app beat
// (KinoVideo layers them above this in its own passes).
//
// Scope: this lands the still-image path (asset PNG + mask.png) fully — enough to compile, be wired,
// and render a real region-split frame in the Task 9 render smoke. Video asset frames (/vframes) and
// per-frame mask.mp4 seeking reuse the T6 bgTextures video path and are the remaining integration
// (see task-11-report.md). Until then a video asset/mask holds its first decoded frame.
import React, { useLayoutEffect, useRef } from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "./runtime";
import type { RegionShaderProps, Theme } from "../../props.js";
import { assembleRegionShaderSource } from "../../shaderSource.js";

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

interface Prog {
  gl: WebGL2RenderingContext;
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  return new Promise((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("region shader asset failed to load: " + url));
  });
}

function bindTex(gl: WebGL2RenderingContext, unit: number, src: TexImageSource, loc: WebGLUniformLocation | null): WebGLTexture {
  const handle = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (loc) gl.uniform1i(loc, unit);
  return handle;
}

export const RegionShader: React.FC<{ asset: string; region: RegionShaderProps; t: Theme }> = ({ asset, region, t }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ref = useRef<HTMLCanvasElement>(null);
  const progRef = useRef<Prog | null>(null);
  const readyRef = useRef(false);
  const failedRef = useRef(false);

  // Kick off the one-time async texture load + program compile. Draw once ready; re-runs per frame
  // are cheap no-ops until then. ponytail: still path only — the two source images load once; the
  // video asset/mask.mp4 per-frame seek is deferred to the T6 bgTextures reuse (see file header).
  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas || failedRef.current) return;

    if (!progRef.current) {
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true, antialias: false });
      if (!gl) {
        failedRef.current = true;
        return;
      }
      const src = assembleRegionShaderSource(region.subjectCode, region.backgroundCode, []);
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
      const fs = mk(gl.FRAGMENT_SHADER, src);
      if (!vs || !fs) {
        failedRef.current = true;
        return;
      }
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error("RegionShader link failed:\n" + gl.getProgramInfoLog(prog));
        failedRef.current = true;
        return;
      }
      const loc: Record<string, WebGLUniformLocation | null> = {};
      for (const n of ["iResolution", "iTime", "iFrame", "iTimeDelta", "uTex0", "uMask", "uChannel"]) {
        loc[n] = gl.getUniformLocation(prog, n);
      }
      progRef.current = { gl, prog, loc };

      // Async: load asset → uTex0 and mask → uMask, then flip the ready flag. A late first frame
      // paints the night fill until the textures arrive.
      Promise.all([loadImage(staticFile(asset)), loadImage("/public/" + region.maskSrc)])
        .then(([assetImg, maskImg]) => {
          gl.useProgram(prog);
          bindTex(gl, 0, assetImg, loc.uTex0);
          bindTex(gl, 1, maskImg, loc.uMask);
          readyRef.current = true;
        })
        .catch((err) => {
          console.error(String(err));
          failedRef.current = true;
        });
    }

    const p = progRef.current;
    if (!p || !readyRef.current) return;
    const { gl, prog, loc } = p;
    const W = width, H = height;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.uniform3f(loc.iResolution, W, H, 1);
    gl.uniform1f(loc.iTime, frame / 30);
    gl.uniform1i(loc.iFrame, frame);
    gl.uniform1f(loc.iTimeDelta, 1 / 30);
    const ch = CHANNEL_VEC[region.channel] ?? CHANNEL_VEC.gray;
    gl.uniform4f(loc.uChannel, ch[0], ch[1], ch[2], ch[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  });

  return (
    <AbsoluteFill style={{ backgroundColor: t.night }}>
      <canvas ref={ref} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};
