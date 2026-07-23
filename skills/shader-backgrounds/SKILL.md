---
name: shader-backgrounds
description: >
  Use when authoring or debugging kino WebGL shader backgrounds (.frag/.glsl
  ShaderToy mainImage) — custom raymarch/plasma stages, texture channels,
  u_* param aliases, and pairing with kino-glass liquid refraction. Not for
  Canvas2D brand-wash, Blender, or ordinary motion HTML chrome.
---

# Shader backgrounds in kino

Kino's "3D" look on this branch is **deterministic WebGL2 fragment shaders**
(ShaderToy `mainImage`) as custom faceless backgrounds, optionally paired with
**`kino-glass`** liquid refraction in motion HTML. Not Blender. Not `.scene.js`.

**Craft bar:** `projects/old-light/` (raymarched crystal + galaxy `uTex0` refraction)
and `projects/vesper/` (`ink-bloom.frag` + dual textures + liquid-glass motion).
Copy the *math and sampling habits*, not the aesthetic.

Contract details: `docs/spec-reference.md` (Shader backgrounds). Quality env:
`docs/build-and-preview.md` (Render speed). Library ids: `assets-lib/backgrounds/`.

## When to use

| Need | Use |
|---|---|
| Authored full-bleed stage with real depth / plasma / refraction of a photo | **Shader** `.frag` (`background:"custom"`) |
| Cheap brand horizon wash, no GPU | Canvas2D `brand-wash` (or presets) |
| Typed UI, chrome, camera choreography | Motion HTML (`kind:"motion"`) — shader stays *behind* as field |
| Frosted UI panel fog | CSS `backdrop-filter: blur()` — **not** a shader substitute for liquid glass |
| True bent-rim glass over a stage | Motion `class="kino-glass"` **over** a structured colorful shader (vesper) |

Hand off: beat job / hierarchy → `motion-design`. Trailer structure → `video-production`.
Overlap QA → `adversarial-critique`.

## Spec seam

```jsonc
{
  "background": "custom",
  "backgroundComponent": "backgrounds/ink-bloom.frag",  // or bare id: "aurora-flow"
  "backgroundIntensity": 1,
  "backgroundTextures": ["images/nebula.jpg", "images/jelly.jpg"],
  "backgroundKeyframes": [
    { "at": 0, "params": { "colorA": "#0a0614", "bloom": 0.15, "drift": 0.2 } },
    { "at": 5.5, "params": { "bloom": 0.45, "drift": 0.35 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 1.2, "action": "pulse" }]
}
```

- Bare id → `assets-lib/backgrounds/<id>.{js,frag,glsl}` (first hit; collision errors).
- Project path → `assets/backgrounds/….frag` under the project.
- Same keyframe/trigger surface as Canvas2D presets. `pulse` → `uPulse`.
- `backgroundTextures[i]` → `uTexI` / `uTexSizeI` (image path, or `.html` DOM texture;
  optional `{ "source", "param" }` live-scrub — see spec-reference).

Author **only** `void mainImage(out vec4 fragColor, in vec2 fragCoord)`. Kino wraps
GLSL ES 3.00 + uniforms + helpers (`src/render/shaderSource.ts`).

Gold specs: `projects/old-light/specs/old-light.json`,
`projects/vesper/specs/vesper-rite.json`.

## Uniform contract

| Uniform | Source |
|---|---|
| `iResolution` | frame `[w,h,1]` |
| `iTime` | **`frame / fps` only** — no wall clock |
| `iFrame` / `iTimeDelta` | frame index / `1/fps` |
| `uPulse` | `backgroundTriggers` envelope |
| `uColorA/B/C` | hex params / brand colors |
| `uIntensity` | `backgroundIntensity` + keyframed `intensity` |
| `uParam0`..`uParam3` | extra **numeric** params, **sorted by key**, max 4 |
| `uTex0`..`uTex3` + `uTexSize*` | `backgroundTextures` (unbound size ≈ `(0,0)`) |

Reserved (not packed into `uParam*`): `colorA`, `colorB`, `colorC`, `intensity`.

### `u_<name>` aliases

`extraParamNames` sorts numeric extras and injects `#define u_bloom uParam0` (etc.).
Prefer `u_bloom` / `u_drift` in GLSL — do not hard-code slot indices. Alphabetical order
is stable across frames; renaming a param can reshuffle slots — aliases absorb that.

```glsl
float bloom = clamp(u_bloom, 0.0, 1.0);  // from keyframe "bloom"
```

Ceiling: **4** extras. More numeric keys are dropped after sort+slice.

## Injected helpers (prefer these)

Always injected; unused compile away:

| Helper | Job |
|---|---|
| `aastep(edge, x)` | Analytic ~1px AA on hard thresholds (masks, SDF cutoffs) |
| `kinoMirrorUV(uv)` | Mirror-fold out of `[0,1]` — kills CLAMP edge streaks |
| `kinoCoverUV(texSize, fragCoord)` | Aspect-correct **cover-fit** local uv |
| `kinoBackdrop(tex, texSize, fragCoord)` | Full-frame cover sample + mirror |
| `kinoBackdropOffset(tex, texSize, fragCoord, offset)` | Same, displaced by bent ray xy |

**Old-light craft bar** (helpers encode this — use them instead of re-deriving):

1. **Cover-fit at the pixel's own coord** — sample the photo/galaxy at
   `kinoCoverUV(uTexSize0, fragCoord)` (or `kinoBackdrop`). **Not** a centre-slice
   projection (`0.5 + dir.xy * k`) — that zooms ~25% of the image and looks soft forever.
2. **Mirror-fold** edges — GL wrap is `CLAMP_TO_EDGE`; lens offsets near the frame edge
   otherwise smear into scanline streaks.
3. **Lens = offset of local uv** — refraction/reflection is
   `kinoBackdropOffset(..., bentDir.xy * throw)`, not a re-projection of the view ray
   into texture space.

```glsl
vec3 bg = kinoBackdrop(uTex0, uTexSize0, fragCoord).rgb;
vec3 refrR = kinoBackdropOffset(uTex0, uTexSize0, fragCoord, rr.xy * throwR).rgb;
```

`old-light.frag` and `ink-bloom.frag` call these helpers — copy that habit.

## Determinism

- Motion = `iTime` / `uPulse` / keyframed params only.
- Never `Date.now`, wall-clock uniforms, or unseeded noise that depends on wall time.
- Same frame index → same pixels (SwiftShader default). `KINO_GPU=1` is faster, not
  bit-identical across machines — cache keys separate.

## Pairing with `kino-glass` (vesper pattern)

Liquid glass **refracts the background canvas**. Flat night fields make the lens invisible.

1. Shader stage: structured + colorful (filaments, caustics, photo plates) —
   `ink-bloom.frag` / `liquid-orb` / custom.
2. Motion HTML: `class="kino-glass"` on the hero mass; keep element background transparent.
3. Drive knobs via CSS vars (tween with motion params/keyframes):

| Var | Role |
|---|---|
| `--glass-strength` / `--glass-band` / `--glass-chroma` / `--glass-profile` | bend + dispersion |
| `--glass-frost` / `--glass-edge-blur` | body / rim blur (keep low for "liquid") |
| `--glass-film` / `--glass-saturate` / `--glass-brightness` | film grade |
| `--glass-morph` / `--glass-from` / `--glass-to` | SDF shape continuum |
| **`--glass-tilt`** | degrees — rotate **in-shader**; never CSS-`rotate` the glass node |
| **`--glass-fit`** | override SDF fit (default: untilted → `1`, any tilt → `0.7`) for known-static tilted cards |

Stress-test: rim must **bend** structured lines, not shear/ghost. Copyable motion:
`assets-lib/motion/liquid-glass.html`. Full glass craft: `motion-design` → Liquid glass.

## Quality: draft vs final

| Mode | SSAA | Notes |
|---|---|---|
| Mock / `KINO_SHADER_DRAFT=1` | **1** | cheap iterate |
| Final encode | **2** default | override `KINO_SHADER_SSAA=1..4` |
| FXAA | **on** by default | `KINO_SHADER_FXAA=0` to disable |

FXAA is a whole-frame edge pass after the shader — free silhouette cleanup. Use `aastep`
where you want an edge extra-crisp (masks, rings). Heavy raymarch + glass → prefer
`KINO_GPU=1` for wall-clock speed when iterating.

## Anti-patterns

- Centre-slice texture zoom (`0.5 + rd.xy * k`) instead of cover-fit local uv
- Relying on CLAMP edges without `kinoMirrorUV` / `kinoBackdrop*`
- CSS-rotating a `.kino-glass` element (breaks backdrop sampling) — use `--glass-tilt`
- Frosted `backdrop-filter: blur()` pretending to be liquid glass
- `Date.now` / wall clock / non-deterministic noise in the frag
- Flat single-color field under `kino-glass` (nothing to refract)
- More than four numeric extras (silently truncated)
- Stock `mesh` left as the hero stage when the brand should feel authored

## Proof loop

```bash
# Gold exemplars
kino still projects/old-light/specs/old-light.json --around 10
kino still projects/vesper/specs/vesper-rite.json --segment 0 --around 1.5

# Your project
kino still specs/foo.json --around <t>
KINO_SHADER_DRAFT=1 kino build specs/foo.json --mock   # fast look
kino build specs/foo.json                              # SSAA 2 + FXAA
```

Check: full-res backdrop (not soft centre crop), clean gem/rim edges, glass bends structure,
pulses land on triggers, stills match encode (determinism).

## Library + exemplars

**Bundled** (`assets-lib/backgrounds/`): `aurora-flow`, `liquid-orb`, `liquid-glass`,
`orb-badge`, `ui-hero` — see folder README. Canvas2D sibling: `brand-wash`.

**Project gold:**

- `projects/old-light/assets/backgrounds/old-light.frag` — cover-fit galaxy + chromatic lens
- `projects/vesper/assets/backgrounds/ink-bloom.frag` — structured ink for glass refraction

## Related

- `docs/spec-reference.md` — Shader backgrounds uniforms / textures
- `docs/backgrounds-and-overlays.md` — faceless presets + custom
- `docs/build-and-preview.md` — `KINO_SHADER_*` / `KINO_GPU`
- `skills/motion-design` — composition + `kino-glass` knobs
- `src/render/shaderSource.ts` — assemble / helpers / aliases (source of truth)

## Exemplar lessons

- **Prefer helpers over hand-rolled cover/mirror.** `old-light` and `ink-bloom` call
  `kinoBackdrop` / `kinoBackdropOffset` / `kinoMirrorUV` / `kinoCoverUV`. Re-deriving the
  same math in each frag drifts and reintroduces the centre-slice / CLAMP-streak bugs.
- **Named extras → `u_<name>`, never raw `uParamI`.** Vesper keyframes `bloom`/`drift` →
  `u_bloom`/`u_drift`. Alphabetical packing reshuffles when you rename a key; aliases absorb it.
  Library frags that must boot without the named param can `#ifdef u_reveal` … `#else uParamN`.
- **Full-bleed photo ≠ panel decal.** `kinoBackdrop*` is for screen-filling plates (galaxy,
  nebula). `orb-badge` / `ui-hero` map `uTex0` in *object* UV space — do not cover-fit those.
- **Drift offsets need mirror.** Even a tiny parallax (`±0.02`) on a full-bleed sample leaves
  `[0,1]` at the frame edge; without `kinoMirrorUV` / `kinoBackdropOffset`, CLAMP smears streaks.
  Drop hand-rolled `uv*0.92+0.04` insets once edges mirror — that inset was a streak workaround.
- **`kino-glass` doubled-card:** untilted lens fit is `1.0` (matches element); any tilt falls
  back to `0.7` AABB (spin-safe, no pulse). Known-static tilted cards → set `--glass-fit`.
  Never CSS-`rotate` the glass node — use `--glass-tilt`.
- **Preserve look while hardening.** Swap sampling helpers; do not redesign the SDF, palette,
  or motion curve. Prove with `kino still … --at` / `--around` before calling it done.

## Runtime notes for skill

Hardening footguns (WebGL runtime, not Blender):

- **Texture index = spec index.** `backgroundTextures[i]` → `uTexI`. Failed load leaves that
  slot empty (transparent 1×1); later entries do **not** shift into earlier units.
- **Upload clamp uses pixel size.** HTML channels rasterize at 2×; `uTexSize*` is css-px
  (aspect). Cap against `canvas.width` / `img.naturalWidth`, not the css dims — css-only clamp
  lets a 2× raster exceed `GL_MAX_TEXTURE_SIZE` and silently black out.
- **Extra params: compile-time name list.** ≤4 numerics → `uParam0..3` + `#define u_<name>`.
  Runtime packs by `extraParamNames(base, keyframes)` — never re-sort a partial frame dict
  (slot drift vs aliases).
- **FXAA FBO must not stay bound for sampling** while the shader draws into it (undefined /
  feedback). Runtime unbinds unit 4 every frame before pass 1; don’t “optimize” that away.
- **FXAA is opaque RGB.** Fine for fullscreen backgrounds; not for intentional alpha mattes.
- **Glass fit:** untilted → `uFit=1`; `|tilt|≥~0.57°` → `0.70`. Static tilted cards →
  `--glass-fit`. No per-frame angle-exact fit (pulses on spin; breaks still/video match).

## Hero reel lessons

From dogfooding `projects/kino-hero-reel/` (`nothing-here-was-filmed`):

- **One shader per spec.** Top-level `background` only — multi-shader pieces = section specs +
  stitch script (`build-reel.sh`), not one `kino build`.
- **`--mock` filenames use `-draft` infix.** Stitch scripts must glob `*-draft-*.mp4`
  (`--mock` is an alias for draft mode).
- **`backgroundTriggers` = `{ at, action }` only** — no `atWord`. Speech-lock lives on motion /
  `motionOverlay` keyframes + triggers.
- **Planar decal ≠ backdrop.** Card/badge on a raymarched plane samples `uTex0` in object UV;
  `kinoBackdrop*` would wrong-fit. Prefer `aastep` + `u_<name>` for wipes/reveals.
- **Live-scrub can be DOM-only.** A texture `{ source, param: "fill" }` may drive CSS typing
  while the frag only reads `u_scan` — keep both numeric so `extraParamNames` stays stable.
- **Glass CTA:** no CSS `border` (ghosts a second rect); drive `--glass-*` from tweened params.
- Proof: `projects/kino-hero-reel/out/nothing-here-was-filmed-draft-{9x16,16x9}.mp4`.
