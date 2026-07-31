// Wrap an author-written transition shader into a compilable fragment shader.
//
// The entry point is ShaderToy's `mainImage(out vec4 fragColor, in vec2 fragCoord)` — the exact same
// signature `backgroundComponent` shaders use, so there is one shader dialect in kino, not two. What
// differs is what's in scope: a transition gets the two beats (`kinoFrom` / `kinoTo`) and the
// progress through the handoff (`uP`), instead of a clock.
//
// Author params (`transitionParams`) arrive as readable `u_<name>` aliases over uParam0..N, again
// matching the background contract. Pure — GL-free, so it unit-tests in Node.

/** Numeric author params that fit into uniform slots, sorted for a stable slot assignment. */
export const TRANSITION_PARAM_SLOTS = 8;

/** Colour params (`"#ff00aa"` in transitionParams) get their own vec3 slots — a colour cannot ride
 *  a float slot, and the two kinds must not compete for the same eight. */
export const TRANSITION_COLOR_SLOTS = 4;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `#rgb` / `#rrggbb` → 0..1 rgb. Anything else is not a colour param. */
export function parseHexColor(v: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1]!.length === 3 ? m[1]!.split("").map((c) => c + c).join("") : m[1]!;
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const UNIFORM_HEADER = [
  "uniform sampler2D uFrom;   // the outgoing beat, already composited",
  "uniform sampler2D uTo;     // the incoming beat, already composited",
  "uniform vec2  uRes;        // framebuffer size in px",
  "uniform vec3  iResolution; // ShaderToy-compatible alias of uRes (z = 1.0)",
  "uniform float uP;          // 0 at the first overlapping frame, 1 at the last",
  "uniform vec3  uCamFrom;    // camera carried through the cut: zoom, panX, panY (outgoing side)",
  "uniform vec3  uCamTo;      // …and the incoming side",
  "uniform float uCamBlur;    // directional smear along the camera's travel",
  "uniform float uCamHold;    // fraction of each side held at full extent (ramp/plateau/ramp)",
  "// Resolved brand palette, linear 0..1 rgb — the same five roles brand.md names. A shader that",
  "// paints its own pigment (ink, fire, edge glow) should take its hue from these rather than",
  "// hard-coding one, so a transition looks like the brand it ships in without being reconfigured.",
  "uniform vec3  uBrandBg;     // page/background base",
  "uniform vec3  uBrandFg;     // text ink",
  "uniform vec3  uBrandAccent; // primary accent",
  "uniform vec3  uBrandAccent2;// secondary/bright accent",
  "uniform vec3  uBrandDeep;   // deep fill",
  ...Array.from({ length: TRANSITION_PARAM_SLOTS }, (_, i) => `uniform float uParam${i};`),
  ...Array.from({ length: TRANSITION_COLOR_SLOTS }, (_, i) => `uniform vec3  uColor${i};`),
].join("\n");

// Sampling helpers, so an author never hand-rolls the uv flip or forgets which sampler is which.
const GLSL_HELPERS = `
// A camera move (spec \`transitionCamera\`) is applied INSIDE these helpers, so it composes with any
// shader without the shader knowing. \`t\` is each side's distance from its own endpoint, so the
// transform is identity there and your endpoint contract is unaffected.
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
// Sample the OUTGOING beat at normalised uv (0..1, y up).
vec4 kinoFrom(vec2 uv) { return kinoCamSample(uFrom, uv, uCamFrom, uP); }
// Sample the INCOMING beat at normalised uv.
vec4 kinoTo(vec2 uv) { return kinoCamSample(uTo, uv, uCamTo, 1.0 - uP); }
// fragCoord → normalised uv, the coordinate both samplers expect.
vec2 kinoUv(vec2 fragCoord) { return fragCoord / uRes; }

// THE COLOUR RULE for anything a transition paints itself — ink, fire, an edge glow, a bevel:
//
//   vec3 ink = kinoPick(u_<name>, uBrandAccent);   // <name> is your own param's name
//
// One call covers all three cases an author needs. If the spec set that param to a hex you get that
// colour; if it didn't, you get the brand's, so the transition looks like the brand it ships in
// without being configured. Passing a literal as the fallback is the escape hatch for an effect
// whose colour is physical rather than editorial (white-hot metal, black char).
//
// The sentinel is a NEGATIVE channel, which no real colour can hold: an omitted \`u_<name>\` is
// defined to vec3(-1.0) by the assembler, and every supplied colour is 0..1. Zero would have been
// ambiguous — black is a colour someone may well ask for.
vec3 kinoPick(vec3 c, vec3 fallback) { return c.r < 0.0 ? fallback : c; }
`;

/** Numeric param names in slot order (alphabetical, so a slot is stable across frames). */
export function transitionParamNames(params: Record<string, number | string> = {}): string[] {
  return Object.entries(params)
    .filter(([, v]) => typeof v === "number")
    .map(([k]) => k)
    .sort()
    .slice(0, TRANSITION_PARAM_SLOTS);
}

/** Colour param names in slot order — the string values that parse as hex. Same alphabetical rule
 *  as the numeric slots, and a separate list so the two never collide. */
export function transitionColorNames(params: Record<string, number | string> = {}): string[] {
  return Object.entries(params)
    .filter(([, v]) => typeof v === "string" && parseHexColor(v) !== null)
    .map(([k]) => k)
    .sort()
    .slice(0, TRANSITION_COLOR_SLOTS);
}

function paramAliases(names: string[], colors: string[]): string {
  return [
    ...names.map((n, i) => (IDENT.test(n) ? `#define u_${n} uParam${i}` : "")),
    ...colors.map((n, i) => (IDENT.test(n) ? `#define u_${n} uColor${i}` : "")),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * `#define`s to `0.0` every `u_<name>` the body references that the spec did NOT declare.
 *
 * Without this, a param is only optional in theory: `u_bleed` is a bare identifier, so omitting
 * `bleed` from `transitionParams` is a GLSL compile error and the whole render dies. That makes
 * every param mandatory in practice and every shader brittle to reuse — the opposite of a knob.
 *
 * Zero is the right filler because it is the one value a shader can test for. The house idiom is
 * `u_x > 0.0 ? u_x : <default>` (or `max(u_x, <floor>)`), which turns "omitted" into the author's
 * own default rather than a degenerate zero.
 *
 * COLOURS fill with `vec3(-1.0)` instead, because `0.0` is both the wrong TYPE and — as black — a
 * colour someone may legitimately ask for. Which names are colours is read off the body: a name
 * passed to `kinoPick(...)` is one by construction, so the shader declares its own intent and the
 * assembler never has to guess from a name.
 */
function zeroFillMissing(body: string, declared: string[], colors: string[]): string {
  const referenced = new Set<string>();
  for (const m of body.matchAll(/\bu_([A-Za-z_][A-Za-z0-9_]*)\b/g)) referenced.add(m[1]!);
  const asColor = new Set<string>();
  for (const m of body.matchAll(/\bkinoPick\s*\(\s*u_([A-Za-z_][A-Za-z0-9_]*)\b/g)) asColor.add(m[1]!);
  const known = new Set([...declared, ...colors]);
  const missing = [...referenced].filter((n) => !known.has(n)).sort();
  return missing.map((n) => `#define u_${n} ${asColor.has(n) ? "vec3(-1.0)" : "0.0"}`).join("\n");
}

/**
 * Assemble an author's `mainImage` body into a full GLSL ES 3.00 transition shader.
 *
 * The endpoint contract still applies and is the author's to keep: a transition MUST resolve to
 * exactly `kinoFrom` at uP=0 and exactly `kinoTo` at uP=1, or it pops on every beat boundary.
 * `kino transitions` says so, and the assembled source repeats it where an author will see it.
 */
export function assembleTransitionSource(body: string, paramNames: string[] = [], colorNames: string[] = []): string {
  const aliases = paramAliases(paramNames, colorNames);
  const filler = zeroFillMissing(body, paramNames, colorNames);
  return (
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    UNIFORM_HEADER +
    (aliases ? "\n" + aliases : "") +
    (filler ? "\n" + filler : "") +
    "\n" +
    GLSL_HELPERS +
    "\nout vec4 kino_fragColor;\n\n" +
    "// ---- authored body ----\n" +
    "// CONTRACT: must be exactly kinoFrom(uv) at uP=0 and exactly kinoTo(uv) at uP=1.\n" +
    body +
    "\n// ---- kino entry ----\n" +
    "void main() { mainImage(kino_fragColor, gl_FragCoord.xy); }\n"
  );
}
