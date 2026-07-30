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

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  ...Array.from({ length: TRANSITION_PARAM_SLOTS }, (_, i) => `uniform float uParam${i};`),
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
`;

/** Numeric param names in slot order (alphabetical, so a slot is stable across frames). */
export function transitionParamNames(params: Record<string, number | string> = {}): string[] {
  return Object.entries(params)
    .filter(([, v]) => typeof v === "number")
    .map(([k]) => k)
    .sort()
    .slice(0, TRANSITION_PARAM_SLOTS);
}

function paramAliases(names: string[]): string {
  return names
    .map((n, i) => (IDENT.test(n) ? `#define u_${n} uParam${i}` : ""))
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
 */
function zeroFillMissing(body: string, declared: string[]): string {
  const referenced = new Set<string>();
  for (const m of body.matchAll(/\bu_([A-Za-z_][A-Za-z0-9_]*)\b/g)) referenced.add(m[1]!);
  const missing = [...referenced].filter((n) => !declared.includes(n)).sort();
  return missing.map((n) => `#define u_${n} 0.0`).join("\n");
}

/**
 * Assemble an author's `mainImage` body into a full GLSL ES 3.00 transition shader.
 *
 * The endpoint contract still applies and is the author's to keep: a transition MUST resolve to
 * exactly `kinoFrom` at uP=0 and exactly `kinoTo` at uP=1, or it pops on every beat boundary.
 * `kino transitions` says so, and the assembled source repeats it where an author will see it.
 */
export function assembleTransitionSource(body: string, paramNames: string[] = []): string {
  const aliases = paramAliases(paramNames);
  const filler = zeroFillMissing(body, paramNames);
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
