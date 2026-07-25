// Shader transitions between two composited beat groups.
//
// Every transition MUST be exactly `from` at p=0 and exactly `to` at p=1 — a transition that
// is a hair off at its endpoints pops on every beat boundary. tests/compositor-transitions
// asserts this for each one.
import type { RenderTarget, TargetPool } from "../targets.js";
import type { Transition } from "../../../../motion.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uRes;
uniform float uP;
out vec4 kino_frag;

// Deterministic value noise — frame-independent, so a dissolve is stable under re-render.
float kinoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
`;

const BODIES: Record<Transition, string> = {
  fade: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = mix(texture(uFrom, uv), texture(uTo, uv), uP);
}`,

  dissolve: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = kinoHash(floor(gl_FragCoord.xy));
  float t = smoothstep(n - 0.15, n + 0.15, uP);
  kino_frag = mix(texture(uFrom, uv), texture(uTo, uv), t);
}`,

  "fly-left": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 toUv = uv + vec2(1.0 - uP, 0.0);
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.x);
  kino_frag = mix(texture(uFrom, uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  "fly-up": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 toUv = uv + vec2(0.0, 1.0 - uP);
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.y);
  kino_frag = mix(texture(uFrom, uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  pop: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float s = mix(0.86, 1.0, uP);
  vec2 toUv = (uv - 0.5) / s + 0.5;
  vec4 to = texture(uTo, clamp(toUv, 0.0, 1.0));
  kino_frag = mix(texture(uFrom, uv), to, uP);
}`,

  cut: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = uP < 0.5 ? texture(uFrom, uv) : texture(uTo, uv);
}`,
};

interface Compiled {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
const cache = new WeakMap<WebGL2RenderingContext, Map<string, Compiled>>();

function compile(gl: WebGL2RenderingContext, kind: Transition): Compiled {
  let byKind = cache.get(gl);
  if (!byKind) {
    byKind = new Map();
    cache.set(gl, byKind);
  }
  const hit = byKind.get(kind);
  if (hit) return hit;

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`transition "${kind}" failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, HEADER + BODIES[kind]));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`transition "${kind}" failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["uFrom", "uTo", "uRes", "uP"]) loc[n] = gl.getUniformLocation(prog, n);
  const entry = { prog, loc };
  byKind.set(kind, entry);
  return entry;
}

/** Mix two composited groups into a fresh target. The caller releases all three. */
export function mixGroups(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  from: RenderTarget,
  to: RenderTarget,
  kind: Transition,
  p: number,
): RenderTarget {
  const { prog, loc } = compile(gl, kind);
  const out = pool.acquire(gl, from.w, from.h);
  pool.clear(gl, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.viewport(0, 0, out.w, out.h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, from.tex);
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, to.tex);
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, out.w, out.h);
  gl.uniform1f(loc.uP, Math.min(1, Math.max(0, p)));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return out;
}

/** Test hook: mix a black "from" against a white "to" and read the centre pixel's red. */
export function probeMix(canvas: HTMLCanvasElement, kind: Transition, p: number): number {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const solid = (v: number): WebGLTexture => {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const px = new Uint8Array(canvas.width * canvas.height * 4).fill(v);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return tex;
  };
  const { prog, loc } = compile(gl, kind);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, solid(0));
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, solid(255));
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, canvas.width, canvas.height);
  gl.uniform1f(loc.uP, p);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4);
  gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[0];
}
