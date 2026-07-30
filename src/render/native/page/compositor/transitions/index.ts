// Shader transitions between two composited beat groups.
//
// Every transition MUST be exactly `from` at p=0 and exactly `to` at p=1 — a transition that
// is a hair off at its endpoints pops on every beat boundary. tests/compositor-transitions
// asserts this for each one.
import type { RenderTarget, TargetPool } from "../targets.js";
import type { Transition } from "../../../../motion.js";
import type { WipeParams } from "../../../../wipeSpec.js";
import type { CameraParams } from "../../../../cameraSpec.js";

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
// Wipe parameters (unused, and optimised out, by the other transitions).
uniform float uAngle;   // radians of travel
uniform float uSoft;    // reveal-edge feather, fraction of frame
uniform float uBand;    // lit-edge width, fraction of frame; 0 = no lit edge
uniform vec3  uEdge;    // lit-edge colour
uniform float uGain;    // lit-edge brightness
// Camera carried through the transition (see cameraSpec.ts). xyz = zoom, panX, panY per side.
uniform vec3  uCamFrom;
uniform vec3  uCamTo;
uniform float uCamBlur;
uniform float uCamHold;
out vec4 kino_frag;

// Deterministic value noise — frame-independent, so a dissolve is stable under re-render.
float kinoHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// ---- camera ---------------------------------------------------------------------------------
// Every transition samples its two beats through these, so a camera move composes with all of
// them for free. t is the side's distance from its OWN endpoint, so the transform is exactly
// identity there and no transition's endpoint contract can be broken by adding a camera.
vec2 kinoCamUv(vec2 uv, vec3 cam, float e) {
  return (uv - 0.5) / (1.0 + cam.x * e) + 0.5 + cam.yz * e;
}

// Ramp, then PLATEAU. A linear t only reaches full extent exactly at the boundary and immediately
// starts back, which reads as a drift rather than a punch. smoothstep(0, ramp, t) arrives at full
// by t = ramp and sits there for the rest of the side, so the frame pushes in, HOLDS through the
// cut, then eases out. Exactly 0 at t=0 either way, so the endpoint stays identity.
float kinoCamCurve(float t) {
  return smoothstep(0.0, max(1.0 - uCamHold, 0.05), t);
}

// Directional smear along the camera's own travel, derived from how far this pixel ACTUALLY moves
// right now rather than from t. That distinction is the whole point of the plateau: during the hold
// the frame is stationary, so the velocity is zero and the smear disappears with it. Blurring a
// held frame is what would give the fake away.
vec4 kinoCamSample(sampler2D tex, vec2 uv, vec3 cam, float t) {
  float e = kinoCamCurve(t);
  vec2 base = kinoCamUv(uv, cam, e);
  vec2 vel = (kinoCamUv(uv, cam, kinoCamCurve(min(t + 0.04, 1.0))) - base) / 0.04;
  // Gate is exactly 0 at t=0, so an endpoint can never pick up a tap spread.
  float amt = uCamBlur * length(vel) * smoothstep(0.0, 0.03, t) * 0.25;
  if (amt <= 0.0001) return texture(tex, base);
  vec2 dir = vel / max(length(vel), 1e-5);
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 5; i++) {
    acc += texture(tex, clamp(base + dir * ((float(i) / 4.0 - 0.5) * amt), 0.0, 1.0));
  }
  return acc / 5.0;
}

vec4 kinoFrom(vec2 uv) { return kinoCamSample(uFrom, uv, uCamFrom, uP); }
vec4 kinoTo(vec2 uv)   { return kinoCamSample(uTo,   uv, uCamTo,   1.0 - uP); }
`;

// An edge that REVEALS the incoming beat as it travels, rather than sliding a whole frame in from
// off-screen (fly-*) or cross-fading in place (fade/dissolve). Neither of those reads as a
// transition between two authored compositions: the slide looks like the frame is being shoved
// sideways, and the cross-fade mushes two layouts on top of each other. Here the new beat is simply
// already there, uncovered progressively.
//
// One body serves every direction — the `wipe-<dir>` names are angle shorthands (see wipeSpec.ts),
// and everything about the edge is a uniform, so a diagonal, hard-edged, or unlit wipe is the same
// shader with different numbers.
const WIPE = `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  // Reveal runs along -d, so the incoming beat is uncovered from the +d side first.
  vec2 d = vec2(-sin(uAngle), cos(uAngle));
  // Half-extent of the unit square projected onto d. Normalising by it keeps s in 0..1 for ANY
  // angle, so a diagonal still starts and finishes fully off-frame instead of clipping mid-sweep.
  float r = (abs(d.x) + abs(d.y)) * 0.5;
  float s = (dot(uv - 0.5, d) + r) / (2.0 * r);
  float f = max(uSoft, 0.0005);
  float edge = mix(1.0 + f, -f, uP);
  float m = smoothstep(edge - f, edge + f, s);
  vec4 col = mix(kinoFrom(uv), kinoTo(uv), m);
  if (uBand > 0.0) {
    // Lit edge riding the boundary, scaled by a term that must vanish at both ends or the endpoint
    // contract breaks and the band pops on the next beat. 4p(1-p), NOT sin(pi*p): the sine is only
    // zero for the exact irrational pi, so any float literal leaves a small residue at p=1 (and
    // NaN under a fractional pow). The parabola is exactly 0.0 at both ends in floating point.
    // Credit: found by an agent authoring a custom transition against this same contract.
    float dist = (s - edge) / uBand;
    col.rgb += uEdge * exp(-dist * dist) * (4.0 * uP * (1.0 - uP)) * uGain;
  }
  kino_frag = col;
}`;

const BODIES: Record<Transition, string> = {
  fade: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = mix(kinoFrom(uv), kinoTo(uv), uP);
}`,

  dissolve: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float n = kinoHash(floor(gl_FragCoord.xy));
  float t = smoothstep(n - 0.15, n + 0.15, uP);
  kino_frag = mix(kinoFrom(uv), kinoTo(uv), t);
}`,

  "fly-left": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 toUv = uv + vec2(1.0 - uP, 0.0);
  vec4 to = kinoTo(clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.x);
  kino_frag = mix(kinoFrom(uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  "fly-up": `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 toUv = uv + vec2(0.0, 1.0 - uP);
  vec4 to = kinoTo(clamp(toUv, 0.0, 1.0));
  float covered = step(1.0 - uP, uv.y);
  kino_frag = mix(kinoFrom(uv), to, covered * step(0.0001, uP) + step(0.9999, uP));
}`,

  wipe: WIPE,
  "wipe-down": WIPE,
  "wipe-up": WIPE,
  "wipe-left": WIPE,
  "wipe-right": WIPE,

  pop: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float s = mix(0.86, 1.0, uP);
  vec2 toUv = (uv - 0.5) / s + 0.5;
  vec4 to = kinoTo(clamp(toUv, 0.0, 1.0));
  kino_frag = mix(kinoFrom(uv), to, uP);
}`,

  cut: `
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  kino_frag = uP < 0.5 ? kinoFrom(uv) : kinoTo(uv);
}`,

  // Never compiled: `custom` supplies its own fully-assembled source (see compile()). Present so the
  // Record stays exhaustive — if a transition is ever added to the union, the compiler says so here.
  custom: "",
};

interface Compiled {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
const cache = new WeakMap<WebGL2RenderingContext, Map<string, Compiled>>();

/**
 * Compile (and cache) a transition program.
 *
 * `custom` carries author source, so the cache key is the SOURCE, not the kind — two beats with
 * different custom shaders must not share a program, and two beats with the same one should.
 */
function compile(gl: WebGL2RenderingContext, kind: Transition, customSource?: string): Compiled {
  let byKind = cache.get(gl);
  if (!byKind) {
    byKind = new Map();
    cache.set(gl, byKind);
  }
  const key = kind === "custom" ? `custom:${customSource ?? ""}` : kind;
  const hit = byKind.get(key);
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
  // A custom shader arrives already assembled (own #version + uniform header); the built-ins are
  // bodies that share HEADER.
  const frag = kind === "custom" ? (customSource ?? "") : HEADER + BODIES[kind];
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`transition "${kind}" failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  const NAMES = ["uFrom", "uTo", "uRes", "uP", "uAngle", "uSoft", "uBand", "uEdge", "uGain", "iResolution",
    "uCamFrom", "uCamTo", "uCamBlur", "uCamHold"];
  for (const n of [...NAMES, ...Array.from({ length: 8 }, (_, i) => `uParam${i}`)]) {
    // Null for transitions that do not declare it — GL drops unused uniforms. uniform*() ignores a
    // null location, so the wipe block below is a no-op for fade/dissolve/fly/pop/cut.
    loc[n] = gl.getUniformLocation(prog, n);
  }
  const entry = { prog, loc };
  byKind.set(key, entry);
  return entry;
}

/**
 * Mix two composited groups into a fresh target. The caller releases all three.
 *
 * `invert` runs the transition BACKWARDS — a reveal becomes a conceal, an iris that opens becomes
 * one that closes, a wipe-down becomes a wipe-up. It is implemented as a double flip: feed the
 * shader `1 - p` AND swap which texture is `uFrom` / `uTo`. That composition is what makes it
 * universal and safe:
 *   · every transition gets a reverse for free, including author-supplied ones — no shader knows
 *     it is being inverted, so none of them can get it wrong;
 *   · the endpoint contract survives by construction. At p=0 the shader sees p'=1 and returns its
 *     `uTo`, which IS the real outgoing beat; at p=1 it sees p'=0 and returns the real incoming
 *     one. A shader that is exact at its own endpoints is therefore exact at the inverted ones.
 */
export function mixGroups(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  from: RenderTarget,
  to: RenderTarget,
  kind: Transition,
  p: number,
  wipe?: WipeParams,
  custom?: { source: string; params: number[] },
  invert = false,
  camera?: CameraParams,
): RenderTarget {
  const { prog, loc } = compile(gl, kind, custom?.source);
  const out = pool.acquire(gl, from.w, from.h);
  pool.clear(gl, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.viewport(0, 0, out.w, out.h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  const [src0, src1] = invert ? [to, from] : [from, to];
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src0.tex);
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, src1.tex);
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, out.w, out.h);
  const clamped = Math.min(1, Math.max(0, p));
  gl.uniform1f(loc.uP, invert ? 1 - clamped : clamped);
  if (wipe) {
    gl.uniform1f(loc.uAngle, wipe.angle);
    gl.uniform1f(loc.uSoft, wipe.softness);
    gl.uniform1f(loc.uBand, wipe.edgeWidth);
    gl.uniform3f(loc.uEdge, wipe.edgeColor[0], wipe.edgeColor[1], wipe.edgeColor[2]);
    gl.uniform1f(loc.uGain, wipe.edgeGain);
  }
  if (custom) {
    gl.uniform3f(loc.iResolution, out.w, out.h, 1);
    custom.params.forEach((v, i) => gl.uniform1f(loc[`uParam${i}`], v));
  }
  // Inversion already swapped the textures and flipped p, so the two camera sides swap with them —
  // otherwise a reversed push would pull, and the "one continuous camera" property would break.
  const cam = camera && (invert ? { from: camera.to, to: camera.from, blur: camera.blur, hold: camera.hold } : camera);
  gl.uniform3f(loc.uCamFrom, cam?.from.zoom ?? 0, cam?.from.panX ?? 0, cam?.from.panY ?? 0);
  gl.uniform3f(loc.uCamTo, cam?.to.zoom ?? 0, cam?.to.panX ?? 0, cam?.to.panY ?? 0);
  gl.uniform1f(loc.uCamBlur, cam?.blur ?? 0);
  gl.uniform1f(loc.uCamHold, cam?.hold ?? 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return out;
}

/** Test hook: mix a black "from" against a white "to" and read the centre pixel's red. */
export function probeMix(canvas: HTMLCanvasElement, kind: Transition, p: number, wipe?: WipeParams, invert = false, camera?: CameraParams): number {
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
  gl.bindTexture(gl.TEXTURE_2D, solid(invert ? 255 : 0));
  gl.uniform1i(loc.uFrom, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, solid(invert ? 0 : 255));
  gl.uniform1i(loc.uTo, 1);
  gl.uniform2f(loc.uRes, canvas.width, canvas.height);
  gl.uniform1f(loc.uP, invert ? 1 - p : p);
  const pcam = camera && (invert ? { from: camera.to, to: camera.from, blur: camera.blur, hold: camera.hold } : camera);
  gl.uniform3f(loc.uCamFrom, pcam?.from.zoom ?? 0, pcam?.from.panX ?? 0, pcam?.from.panY ?? 0);
  gl.uniform3f(loc.uCamTo, pcam?.to.zoom ?? 0, pcam?.to.panX ?? 0, pcam?.to.panY ?? 0);
  gl.uniform1f(loc.uCamBlur, pcam?.blur ?? 0);
  gl.uniform1f(loc.uCamHold, pcam?.hold ?? 0);
  if (wipe) {
    gl.uniform1f(loc.uAngle, wipe.angle);
    gl.uniform1f(loc.uSoft, wipe.softness);
    gl.uniform1f(loc.uBand, wipe.edgeWidth);
    gl.uniform3f(loc.uEdge, wipe.edgeColor[0], wipe.edgeColor[1], wipe.edgeColor[2]);
    gl.uniform1f(loc.uGain, wipe.edgeGain);
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const px = new Uint8Array(4);
  gl.readPixels(canvas.width / 2, canvas.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[0];
}
