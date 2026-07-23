// Pure helpers for the WebGL shader background (rung 1). GL-free so they unit-test in Node.
// Determinism: iTime/iFrame come only from the frame index — no wall clock.

export const EXTRA_PARAM_SLOTS = 4;

// Params owned by the fixed uniform header; everything else numeric spills into uParam0..N.
const RESERVED = new Set(["colorA", "colorB", "colorC", "intensity"]);

const UNIFORM_HEADER = [
  "uniform vec3  iResolution;",
  "uniform float iTime;",
  "uniform int   iFrame;",
  "uniform float iTimeDelta;",
  "uniform vec4  iMouse;", // zeroed — ShaderToy paste-compat, no interactivity
  "uniform float uPulse;",
  "uniform vec3  uColorA;",
  "uniform vec3  uColorB;",
  "uniform vec3  uColorC;",
  "uniform float uIntensity;",
  "uniform float uParam0;",
  "uniform float uParam1;",
  "uniform float uParam2;",
  "uniform float uParam3;",
  // Texture channels (spec backgroundTextures[i] → uTexI). Unbound channels sample transparent
  // black; uTexSizeI is the source's css-px size (0,0 when unbound). v=0 is the BOTTOM row
  // (flipped at upload) so uv orientation matches fragCoord.
  "uniform sampler2D uTex0;",
  "uniform sampler2D uTex1;",
  "uniform sampler2D uTex2;",
  "uniform sampler2D uTex3;",
  "uniform vec2 uTexSize0;",
  "uniform vec2 uTexSize1;",
  "uniform vec2 uTexSize2;",
  "uniform vec2 uTexSize3;",
  // Animated (flipbook) channels: uTexFramesN = frame count (1 = static), uTexGridN = atlas
  // cols/rows. Sample a frame with the kinoTexFrame helper below.
  "uniform float uTexFrames0;",
  "uniform float uTexFrames1;",
  "uniform float uTexFrames2;",
  "uniform float uTexFrames3;",
  "uniform vec2 uTexGrid0;",
  "uniform vec2 uTexGrid1;",
  "uniform vec2 uTexGrid2;",
  "uniform vec2 uTexGrid3;",
].join("\n");

// Flipbook sampler: pick atlas cell for `frame` (0..frames-1) and sample uv within it.
// Atlas rows are baked top-down but the upload is Y-flipped (v=0 = bottom), so rows address
// from the bottom here. Static textures (frames=1, grid=1x1) reduce to a plain texture().
const TEX_HELPERS = `
vec4 kinoTexFrame(sampler2D tex, vec2 grid, float frames, vec2 uv, float frame) {
  float f = clamp(floor(frame + 0.5), 0.0, max(frames, 1.0) - 1.0);
  vec2 cell = vec2(mod(f, grid.x), (grid.y - 1.0) - floor(f / grid.x));
  return texture(tex, (cell + clamp(uv, 0.0, 1.0)) / max(grid, vec2(1.0)));
}
// Smooth variant: crossfades adjacent flipbook frames by the fractional frame index, so a
// continuous drive value plays back without visible stepping. Use for anything that moves.
vec4 kinoTexFrameLerp(sampler2D tex, vec2 grid, float frames, vec2 uv, float frame) {
  float fmax = max(frames, 1.0) - 1.0;
  float f0 = clamp(floor(frame), 0.0, fmax);
  float f1 = min(f0 + 1.0, fmax);
  vec4 a = kinoTexFrame(tex, grid, frames, uv, f0);
  vec4 b = kinoTexFrame(tex, grid, frames, uv, f1);
  return mix(a, b, clamp(frame - f0, 0.0, 1.0));
}
`;

/** Wrap an agent-authored ShaderToy `mainImage` body into a compilable GLSL ES 3.00 fragment shader. */
export function assembleShaderSource(body: string): string {
  return (
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    UNIFORM_HEADER +
    "\n" + TEX_HELPERS +
    "\nout vec4 kino_fragColor;\n\n" +
    "// ---- authored body ----\n" +
    body +
    "\n// ---- kino entry ----\n" +
    "void main() { mainImage(kino_fragColor, gl_FragCoord.xy); }\n"
  );
}

/** `#rrggbb` / `#rgb` → normalized [r,g,b]; anything unparseable → white. */
export function hexToVec3(hex: string): [number, number, number] {
  if (typeof hex !== "string") return [1, 1, 1];
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [1, 1, 1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

export interface UniformValues {
  iResolution: [number, number, number];
  iTime: number;
  iFrame: number;
  iTimeDelta: number;
  uPulse: number;
  uColorA: [number, number, number];
  uColorB: [number, number, number];
  uColorC: [number, number, number];
  uIntensity: number;
  uParams: number[];
}

const numOf = (v: unknown, d: number): number => (typeof v === "number" ? v : Number(v) || d);
const colOf = (v: unknown): [number, number, number] => hexToVec3(typeof v === "string" ? v : "#ffffff");

/** Resolved (already-tweened) params + frame context → concrete uniform values. Pure. */
export function resolveUniforms(
  params: Record<string, number | string>,
  ctx: { frame: number; fps: number; width: number; height: number; pulse: number },
): UniformValues {
  const extras = Object.keys(params)
    .filter((k) => !RESERVED.has(k) && typeof params[k] === "number")
    .sort();
  const uParams = Array.from({ length: EXTRA_PARAM_SLOTS }, (_, i) => (i < extras.length ? (params[extras[i]] as number) : 0));
  return {
    iResolution: [ctx.width, ctx.height, 1],
    iTime: ctx.fps > 0 ? ctx.frame / ctx.fps : 0,
    iFrame: ctx.frame,
    iTimeDelta: ctx.fps > 0 ? 1 / ctx.fps : 0,
    uPulse: ctx.pulse,
    uColorA: colOf(params.colorA),
    uColorB: colOf(params.colorB),
    uColorC: colOf(params.colorC),
    uIntensity: numOf(params.intensity, 0.5),
    uParams,
  };
}
