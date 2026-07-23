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
].join("\n");

// Injected GLSL helpers for sampling a texture channel as a full-frame backdrop. Encodes the
// cover-fit + mirror-wrap math authors kept getting wrong by hand (a screen→centre-slice mapping
// magnifies ~25% of the image and blurs it; CLAMP_TO_EDGE offsets smear the border into streaks).
// Unused functions compile away — cheap to always inject.
const GLSL_HELPERS = `
// Analytic edge AA: smoothstep across ~1px of a value's screen-space derivative. Use aastep(edge, x)
// instead of step(edge, x) on any hard threshold (masks, rings, stripes, SDF silhouette cutoffs) to
// kill jaggies without more supersampling. A whole-frame FXAA pass also runs after the shader, so AA
// is free by default — reach for aastep only where you want an edge extra-crisp.
float aastep(float edge, float x){ float w = max(fwidth(x), 1e-5); return smoothstep(edge - w, edge + w, x); }
vec2 kinoMirrorUV(vec2 uv){ return 1.0 - abs(1.0 - fract(uv * 0.5) * 2.0); }
vec2 kinoCoverUV(vec2 texSize, vec2 fragCoord){
  vec2 res = iResolution.xy;
  float ra = res.x / max(res.y, 1.0);
  float ta = texSize.x > 0.5 ? texSize.x / max(texSize.y, 1.0) : ra; // unbound → no reframe
  vec2 s = (ra > ta) ? vec2(1.0, ta / ra) : vec2(ra / ta, 1.0);
  return (fragCoord / res - 0.5) * s + 0.5;
}
// Full-frame cover-fit sample of a channel (aspect-correct, sharp, mirror-wrapped edges).
vec4 kinoBackdrop(sampler2D tex, vec2 texSize, vec2 fragCoord){
  return texture(tex, kinoMirrorUV(kinoCoverUV(texSize, fragCoord)));
}
// Same backdrop, displaced by a bent (refracted/reflected) ray's xy — the refraction/lens lookup.
vec4 kinoBackdropOffset(sampler2D tex, vec2 texSize, vec2 fragCoord, vec2 offset){
  return texture(tex, kinoMirrorUV(kinoCoverUV(texSize, fragCoord) + offset));
}
`;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Sorted numeric author-param names that pack into uParam0..N — the same set and order
 *  resolveUniforms uses, derived from the base params + all keyframes so it is stable across
 *  frames (paramsAt always carries the full key set). Drives the readable `u_<name>` aliases. */
export function extraParamNames(
  base: Record<string, number | string> = {},
  keyframes: { params: Record<string, number | string> }[] = [],
): string[] {
  const numeric = new Set<string>();
  const add = (o: Record<string, number | string>) => {
    for (const [k, v] of Object.entries(o)) if (!RESERVED.has(k) && typeof v === "number") numeric.add(k);
  };
  add(base);
  for (const k of keyframes) add(k.params);
  return [...numeric].sort().slice(0, EXTRA_PARAM_SLOTS);
}

/** Wrap an agent-authored ShaderToy `mainImage` body into a compilable GLSL ES 3.00 fragment
 *  shader. `extraNames` (from extraParamNames) get readable `#define u_<name> uParamI` aliases so
 *  authors reference `u_bloom` instead of memorising which alphabetical slot `bloom` spilled into. */
export function assembleShaderSource(body: string, extraNames: string[] = []): string {
  // Prefixed so an alias can never collide with a bare local: existing shaders write
  // `float reveal = uParam1;` — `reveal` is untouched by `#define u_reveal ...`.
  const aliases = extraNames
    .map((n, i) => (IDENT.test(n) ? `#define u_${n} uParam${i}` : ""))
    .filter(Boolean)
    .join("\n");
  return (
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    UNIFORM_HEADER +
    (aliases ? "\n" + aliases : "") +
    "\n" +
    GLSL_HELPERS +
    "\nout vec4 kino_fragColor;\n\n" +
    "// ---- authored body ----\n" +
    body +
    "\n// ---- kino entry ----\n" +
    "void main() { mainImage(kino_fragColor, gl_FragCoord.xy); }\n"
  );
}

/** Largest [w,h] (same aspect) that fits within `max` on both axes, else the original if it
 *  already fits. Guards texture uploads against a GPU's GL_MAX_TEXTURE_SIZE — a full-res stock
 *  original (e.g. 7680px) silently fails texImage2D on GPUs that cap at 4096/8192. Pure so it
 *  unit-tests in Node; the canvas downscale itself lives in ShaderBackground. */
export function fitTextureDims(w: number, h: number, max: number): [number, number] {
  if (max <= 0 || (w <= max && h <= max)) return [w, h];
  const s = max / Math.max(w, h);
  // round (not floor) + cap: the long edge is exactly `max` in real math but FP can land at
  // max-ε and floor to max-1; round lands on max and the min() keeps every result ≤ max.
  const fit = (n: number) => Math.min(max, Math.max(1, Math.round(n * s)));
  return [fit(w), fit(h)];
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

/** Resolved (already-tweened) params + frame context → concrete uniform values. Pure.
 *  Pass `extraNames` from `extraParamNames(base, keyframes)` so uParam slots match the
 *  `#define u_<name>` aliases baked at compile time — never re-derive from a partial frame dict. */
export function resolveUniforms(
  params: Record<string, number | string>,
  ctx: { frame: number; fps: number; width: number; height: number; pulse: number },
  extraNames?: string[],
): UniformValues {
  const extras =
    extraNames ??
    Object.keys(params)
      .filter((k) => !RESERVED.has(k) && typeof params[k] === "number")
      .sort()
      .slice(0, EXTRA_PARAM_SLOTS);
  const uParams = Array.from({ length: EXTRA_PARAM_SLOTS }, (_, i) => (i < extras.length ? numOf(params[extras[i]], 0) : 0));
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
