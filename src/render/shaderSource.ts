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
// Signed distance in PIXELS from this pixel to the nearest mask boundary: negative inside the
// masked region, positive outside, saturating at ±radius. Region shaders otherwise see only a
// binary in/out, which is what blocks rim light, outline, outward glow, edge fringe and
// erode/dilate. Takes the sampler + channel so it serves any uMask0..3 from either region body.
//
// Two regimes. Inside the mask's own transition band the bilinear-filtered coverage is a ramp,
// so its screen-space gradient gives SUB-PIXEL distance for free — the true gradient magnitude
// length(dFdx, dFdy) reads the fragment quad, not the texture, so it costs no taps (the same
// derivative trick aastep already uses). Outside that band
// the coverage saturates and the gradient collapses, so fall back to a 24-tap search. That
// search is COARSE: its error grows with radius and varies with edge orientation, and a feature
// thinner than the sample spacing (~0.36*radius) can be missed entirely.
// Pass the SMALLEST radius that covers your effect — a 3px rim wants radius 4, not 32.
//
// The 0.05 gate on g is set by the pipeline, not the maths, and is MEASURED, not reasoned: masks
// arrive through lossy H.264 (scripts/sam_runner_cuda.py, crf 16) and then JPEG re-extraction
// (videoFrames.ts, -q:v 2), and DCT ringing gives nominally flat mask regions a spurious gradient.
// Measured on masks built through that exact chain (moving disc, busy silhouette, and the
// BILINEAR 1008→native upscale sam_runner.py does), over ~2M genuinely-flat pixels per frame:
//   flat g: median 0, p99 0, p99.9 0.004–0.011, MAX 0.039–0.044   (stable across crf 16..28)
//   real edge g: median 0.97 hard-edged / 0.40 bilinear-upscaled, up to 1.41
// So 0.01 sits INSIDE the noise (~1000 flat px/frame clear it) and 0.05 sits above it. The two
// populations are ~20x apart, and every gate from 0.02 to 0.4 renders identically — 0.05 is
// comfortably inside that plateau, not balanced on an edge.
// Two caveats the numbers make explicit:
//  - The 0.039–0.044 ceiling above was measured when masks were re-extracted to JPEG q:v 2. Mask
//    jobs now extract to lossless PNG (videoFrames.ts gates on the rsmask key prefix), so coupling
//    is gone for masks; footage still uses -q:v 2 but never feeds this helper.
//  - R/G/B-packed multi-object masks USED to be unusable here: yuv420p subsampled chroma, so an
//    object's boundary rang into ANOTHER object's channel and flat g reached 0.85 — overlapping
//    the real-edge population outright, which no gate value can separate. Masks are now encoded
//    -pix_fmt yuv444p -qp 0, and flat g on the packed channels is 0.0055 (zero px/frame even over
//    0.01). Note it took BOTH: 4:2:0 alone still reads 0.69 when coded losslessly, and lossy 4:4:4
//    alone still reads 0.62. See docs/superpowers/specs/2026-07-24-multi-object-chroma.md.
// The gate stays at 0.05, deliberately, now that the floor is 80x below it. Masks generated BEFORE
// that change are still subsampled and still read up to 0.84, and they must keep rendering —
// lowering the gate to buy analytic reach would newly break every mask already on disk, to fix no
// observed defect (0.02 through 0.4 render identically).
// What a leaky gate actually costs is NOT deep-region speckle — a flat pixel answers 0.5/g, which
// still clamps to ±radius unless 0.5/g < radius. It is the annulus within one radius of the edge,
// where ringing is strongest: there the wrong branch drags the field to ±radius and moves every
// isoline. tests/render-maskdist-video.test.ts measures it (erode lands ~22px off at 0.01).
// 0.05 leaves ~10px of analytic reach (the branch resolves 0.5/g px), which covers the transition
// band any real effect reads.
// Reads only the texture, the coordinate and derivatives, so determinism holds.
#define KINO_MASK_TAPS 24
float kinoMaskDist(sampler2D mask, vec4 channel, vec2 fragCoord, float radius){
  vec2 res = iResolution.xy;
  vec2 uv = fragCoord / res;
  vec2 texel = 1.0 / res;
  float m = dot(texture(mask, uv), channel);
  float g = length(vec2(dFdx(m), dFdy(m)));
  if (g > 0.05) return clamp((0.5 - m) / g, -radius, radius);
  float here = step(0.5, m);
  float best = radius;
  for (int i = 0; i < KINO_MASK_TAPS; i++){
    float r = (float(i) + 1.0) / float(KINO_MASK_TAPS) * radius;
    float a = float(i) * 2.39996323;
    float s = step(0.5, dot(textureLod(mask, uv + vec2(cos(a), sin(a)) * r * texel, 0.0), channel));
    if (s != here) { best = r; break; }
  }
  return here > 0.5 ? -best : best;
}
#undef KINO_MASK_TAPS
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

// `#define u_<name> uParamI` aliases. Prefixed so an alias can never collide with a bare local:
// existing shaders write `float reveal = uParam1;` — `reveal` is untouched by `#define u_reveal`.
function paramAliases(extraNames: string[]): string {
  return extraNames
    .map((n, i) => (IDENT.test(n) ? `#define u_${n} uParam${i}` : ""))
    .filter(Boolean)
    .join("\n");
}

/** Wrap an agent-authored ShaderToy `mainImage` body into a compilable GLSL ES 3.00 fragment
 *  shader. `extraNames` (from extraParamNames) get readable `#define u_<name> uParamI` aliases so
 *  authors reference `u_bloom` instead of memorising which alphabetical slot `bloom` spilled into. */
export function assembleShaderSource(body: string, extraNames: string[] = []): string {
  const aliases = paramAliases(extraNames);
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

// Up to this many mask sources union into one subject region (see RegionShaderProps.masks).
export const MAX_REGION_MASKS = 4;

// Region-shader extra uniforms: up to MAX_REGION_MASKS segmentation mask samplers, each with a
// dot-swizzle channel selector. uChannelN picks maskN's manifest object's coverage channel at bind
// time (r/g/b/a/gray→r); an unbound slot's uChannelN is left at (0,0,0,0) so it never contributes to
// the union regardless of what's in its (placeholder) texture — same "unbound reads as nothing"
// convention as uTex0..3.
const REGION_HEADER =
  UNIFORM_HEADER +
  "\n" +
  Array.from(
    { length: MAX_REGION_MASKS },
    (_, i) => `uniform sampler2D uMask${i};\nuniform vec4 uChannel${i};`,
  ).join("\n");

// Null-side body: sample the beat asset (uTex0) unchanged. fragCoord/iResolution.xy is the 0..1 uv
// (textures upload UNPACK_FLIP_Y'd, so v=0 is the bottom row — matches gl_FragCoord orientation).
const REGION_PASSTHROUGH =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = texture(uTex0, fragCoord / iResolution.xy); }";

// Backdrop-side passthrough: with a `backdrop` clip bound, the BACKGROUND region shows that clip
// rather than the beat's own plate — which is the whole cutout, and the only thing most specs will
// want. Cover-fit (not the subject side's fragCoord/iResolution stretch) because the backdrop is an
// unrelated clip whose aspect will not match the beat's; kinoCoverUV needs uTexSize1, which
// RegionShader uploads for exactly this. The SUBJECT passthrough deliberately stays on uTex0 — the
// subject is the thing being cut out, and a backdrop there would erase it.
const REGION_BACKDROP_PASSTHROUGH =
  "void mainImage(out vec4 fragColor, in vec2 fragCoord){ fragColor = kinoBackdrop(uTex1, uTexSize1, fragCoord); }";

// Readable names for the backdrop's slot. It rides the ALREADY-DECLARED uTex1/uTexSize1 (region
// shaders bind only uTex0), so no uniform is added, and emitting the aliases conditionally — the way
// BG_FORWARD_DECL is emitted — keeps a spec without a backdrop byte-for-byte what it was.
const BACKDROP_ALIASES = "#define uBackdrop uTex1\n#define uBackdropSize uTexSize1\n";

/** Assemble ONE GLSL ES 3.00 fragment shader that splits the frame by the segmentation mask(s).
 *  A null body on either side is a passthrough of the beat asset (uTex0); every body's `mainImage`
 *  is #define-namespaced so they never collide in the one translation unit they share.
 *
 *  Default (no `maskBodies`): every mask unions into ONE subject region — `subjectBody` shades
 *  where any bound mask channel > 0.5, `backgroundBody` elsewhere.
 *
 *  Per-object (any entry of `maskBodies` non-null): each mask gets its own body, falling back to
 *  `subjectBody` where its entry is null, composited onto the background in ARRAY ORDER — later
 *  entries paint over earlier ones where masks overlap. `maskBodies` is index-aligned with
 *  RegionShaderProps.masks. See docs/superpowers/specs/2026-07-24-per-object-regions-design.md.
 *
 *  `hasBackdrop`: the beat binds a SECOND source (regionShader.backdrop) to uTex1 — a cutout over
 *  footage that isn't the beat's own. Adds the uBackdrop/uBackdropSize aliases and makes a
 *  passthrough BACKGROUND that backdrop, cover-fit. False emits exactly the bytes it always did.
 *  See docs/superpowers/specs/2026-07-25-cutout-compositing-design.md. */
export function assembleRegionShaderSource(
  subjectBody: string | null,
  backgroundBody: string | null,
  extraNames: string[] = [],
  maskBodies: (string | null)[] = [],
  hasBackdrop = false,
): string {
  const aliases = paramAliases(extraNames);
  const subj = subjectBody ?? REGION_PASSTHROUGH;
  const bg = backgroundBody ?? (hasBackdrop ? REGION_BACKDROP_PASSTHROUGH : REGION_PASSTHROUGH);
  const head =
    "#version 300 es\n" +
    "precision highp float;\n\n" +
    REGION_HEADER +
    (aliases ? "\n" + aliases : "") +
    "\n" +
    (hasBackdrop ? BACKDROP_ALIASES : "") +
    GLSL_HELPERS +
    "\nout vec4 kino_fragColor;\n\n";
  // A slot past MAX_REGION_MASKS has no uMaskN uniform to name — drop it rather than emit GLSL
  // that cannot compile. (The schema caps masks[] at 4; this is belt-and-braces.)
  const per = maskBodies.slice(0, MAX_REGION_MASKS);
  return head + (per.some(Boolean) ? perObjectTail(per, subj, bg) : unionTail(subj, bg));
}

// Every mask unions into ONE subject region. This is the shape kino shipped before per-object
// regions and is emitted byte-for-byte unchanged whenever no mask carries its own body — a spec
// that doesn't use the feature must not pay for it, or change output at all.
// Cross-region sampling. The background body is emitted as a PURE function of fragCoord, so
// evaluating it at fragCoord+offset IS an offset sample of the shaded background — exact,
// full-resolution, no framebuffer, no second pass, no feedback hazard. The only thing blocking it is
// ORDER: subject bodies are emitted BEFORE the background body in the one translation unit they
// share, and GLSL wants a declaration first. Hence this forward declaration, plus a `kinoBackground`
// alias scoped to subject bodies the way uMaskSelf/uChannelSelf already are.
//
// Deliberately NOT defined for the background body: that would be recursion (illegal in GLSL) and
// has no meaning, so leaving it undefined makes the mistake a loud compile error against
// line-numbered source rather than a silent one. A subject cannot sample ANOTHER subject either —
// under painter's order a subject's output is discarded outside its own mask, so the question has no
// answer exactly where you'd want to ask it.
//
// Emitted ONLY when a subject-side body actually names it, so a spec that doesn't use the feature
// gets byte-identical GLSL — the bar phases 2 and 3 held.
// ponytail: substring test, not a GLSL parse. A body naming it in a comment gets an unused
// declaration and an unused macro (harmless); one that builds the name through its own macro doesn't
// match and gets the compile error above. Parse the source if that ever costs anyone anything.
//
// Cost is one evaluation of the background body per call — measured +0.019 s/frame for a light body
// and +0.112 for one 10x heavier (1080x1920, 12 stills, SwiftShader). That is ~5% of what the three
// kinoMaskDist calls in a typical bevel already cost, which is why this is a body call and not an
// FBO. Cost is taps x body weight and nothing else, so the one shape that gets dear is a WIDE kernel
// over an EXPENSIVE background (8 taps heavy = +0.47 s/frame). That is where a real two-pass
// framebuffer becomes the right answer; this signature does not change when it lands.
// See docs/superpowers/specs/2026-07-25-cross-region-design.md.
const BG_FORWARD_DECL = "void regionBg(out vec4 fragColor, in vec2 fragCoord);\n";
const usesBackground = (bodies: (string | null)[]): boolean => bodies.some((b) => b?.includes("kinoBackground"));

function unionTail(subj: string, bg: string): string {
  const xr = usesBackground([subj]);
  return (
    (xr ? BG_FORWARD_DECL : "") +
    // Preprocessor-namespace each body's mainImage → two collision-free functions. Bodies are the
    // normal shader convention, reused unchanged.
    "// ---- subject region body ----\n" +
    (xr ? "#define kinoBackground regionBg\n" : "") +
    "#define mainImage regionSubject\n" +
    subj +
    "\n#undef mainImage\n" +
    (xr ? "#undef kinoBackground\n" : "") +
    "// ---- background region body ----\n" +
    "#define mainImage regionBg\n" +
    bg +
    "\n#undef mainImage\n" +
    "// ---- kino region entry ----\n" +
    // ponytail: both bodies run for EVERY pixel then mix — 2× fragment cost. Upgrade to a
    // discard/stencil split (shade only the region each pixel belongs to) if the cost matters.
    "void main() {\n" +
    "  vec4 s, b;\n" +
    "  regionSubject(s, gl_FragCoord.xy);\n" +
    "  regionBg(b, gl_FragCoord.xy);\n" +
    "  vec2 muv = gl_FragCoord.xy / iResolution.xy;\n" +
    "  float m = 0.0;\n" +
    Array.from(
      { length: MAX_REGION_MASKS },
      (_, i) => `  m = max(m, dot(texture(uMask${i}, muv), uChannel${i}));\n`,
    ).join("") +
    // Tight smoothstep for a clean ~1px AA edge (the bulk of the fringe fix is upstream —
    // sam_runner.py erodes the mask before its 1008→native upscale, see _erode1008).
    "  m = smoothstep(0.4, 0.6, m);\n" +
    "  kino_fragColor = mix(b, s, m);\n" +
    "}\n"
  );
}

// One body per mask, composited onto the background in ARRAY ORDER — masks[1] paints over masks[0]
// where they overlap (painter's order). Only the slots this beat actually binds are emitted: an
// unbound uChannelN is the zero vector, so a line for it would be a guaranteed no-op mix at full
// fragment cost.
//
// ponytail: N distinct bodies run for EVERY pixel, so 4 per-object masks is 5x the fragment work
// of a plain background on the default SwiftShader renderer. The shared fallback is emitted and
// called ONCE however many masks share it, and not at all when none do. Upgrade path is the same
// discard/stencil split the union tail wants.
function perObjectTail(per: (string | null)[], subj: string, bg: string): string {
  const needShared = per.some((b) => !b);
  // Every subject-side body, and never the background — see BG_FORWARD_DECL.
  const xr = usesBackground([...per, ...(needShared ? [subj] : [])]);
  // Which local holds each mask's shaded colour: its own body's output, or the shared one's.
  const varOf = (b: string | null, i: number) => (b ? `s${i}` : "sShared");
  return (
    (xr ? BG_FORWARD_DECL : "") +
    per
      .map((b, i) =>
        b
          ? // uMaskSelf/uChannelSelf are scoped to THIS body, so a .frag can rim its own subject
            // (kinoMaskDist(uMaskSelf, uChannelSelf, ...)) without hardcoding an array index.
            // Deliberately absent from the shared and background bodies — those span several masks
            // / the whole frame, so there is no single "self" and using it there is a loud compile
            // error instead of a silently wrong edge. kinoBackground is scoped differently: EVERY
            // subject-side body gets it (there is exactly one background); only the background
            // body does not.
            `// ---- subject region body for mask ${i} ----\n` +
            `#define uMaskSelf uMask${i}\n` +
            `#define uChannelSelf uChannel${i}\n` +
            (xr ? "#define kinoBackground regionBg\n" : "") +
            `#define mainImage regionSubject${i}\n` +
            b +
            "\n#undef mainImage\n" +
            (xr ? "#undef kinoBackground\n" : "") +
            "#undef uChannelSelf\n#undef uMaskSelf\n"
          : "",
      )
      .join("") +
    (needShared
      ? "// ---- shared subject region body (masks without their own) ----\n" +
        (xr ? "#define kinoBackground regionBg\n" : "") +
        "#define mainImage regionSubjectShared\n" +
        subj +
        "\n#undef mainImage\n" +
        (xr ? "#undef kinoBackground\n" : "")
      : "") +
    "// ---- background region body ----\n" +
    "#define mainImage regionBg\n" +
    bg +
    "\n#undef mainImage\n" +
    "// ---- kino region entry ----\n" +
    "void main() {\n" +
    "  vec2 muv = gl_FragCoord.xy / iResolution.xy;\n" +
    "  vec4 c;\n" +
    "  regionBg(c, gl_FragCoord.xy);\n" +
    per.map((b, i) => (b ? `  vec4 s${i};\n  regionSubject${i}(s${i}, gl_FragCoord.xy);\n` : "")).join("") +
    (needShared ? "  vec4 sShared;\n  regionSubjectShared(sShared, gl_FragCoord.xy);\n" : "") +
    // Same 0.4..0.6 smoothstep the union tail uses, applied per composite step for a ~1px AA seam.
    per
      .map(
        (b, i) =>
          `  c = mix(c, ${varOf(b, i)}, smoothstep(0.4, 0.6, dot(texture(uMask${i}, muv), uChannel${i})));\n`,
      )
      .join("") +
    "  kino_fragColor = c;\n" +
    "}\n"
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
