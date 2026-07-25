# Shader Background (Rung 1) — Design

**Date:** 2026-07-23
**Status:** Approved, pre-implementation
**Scope:** One new background variant — a deterministic WebGL fragment-shader backdrop authored in the ShaderToy `mainImage` convention. Background layer only. No motion overlays, no Three.js, no 3D models (that is "rung 2", out of scope here).

## Motivation

Every visual tier in kino today is 2D: Canvas2D backgrounds (`draw(ctx, env)`), CSS/HTML motion (Tier 1), procedural-JS-returns-HTML motion (Tier 2), Lottie (Tier 3). Real 3D exists only as an offline Blender/Cycles bake (~29 min/frame), imported as footage — not agent-authorable per beat, not VO-syncable.

The native render surface is headless Chrome stepping frame-by-frame deterministically (`src/render/native/engine.ts`), which is the ideal host for WebGL — yet nothing uses it. A fragment shader driven by a frame-derived time uniform (instead of a wall clock) is as deterministic as the CSS `--progress` and Canvas2D `env.frame` tricks already in the codebase. This adds the "premium accent-3D" look (liquid gradients, displacement, ray-marched depth, refraction) at the lowest possible cost, riding the existing `custom` background seam.

## Non-goals

- Motion-graphic overlays / per-beat shaders (rung 1 is the full-frame background layer only).
- Three.js, scene graphs, GLTF/texture/HDRI loading (rung 2).
- Pixel-identical output across machines/GPUs (not required — outputs are videos; the frame cache keys on signatures, not pixel hashes).
- Interactivity (`iMouse` is zeroed).

## Architecture

### 1. Spec seam — reuse `custom` / `backgroundComponent` (no schema change)

Authored spec stays:
```json
{ "background": "custom", "backgroundComponent": "aurora-flow.frag" }
```

Resolution lives in `src/media/backgroundLib.ts` (`resolveBackgroundComponent`): bare id → `assets-lib/backgrounds/<id>`, else project `assets/` path, else workspace-relative. Two changes:

- **Extension probe.** Today bare-id resolution and `listBackgroundIds()` assume `.js`. Extend to also find `.frag` / `.glsl`. Bare-id probe order: `.js`, `.frag`, `.glsl` (first hit wins; a collision like `foo.js` + `foo.frag` is a resolve-time error telling the author to disambiguate with a path).
- **Kind discrimination.** The render branch is chosen by the resolved file's extension: `.js` → Canvas2D (today), `.frag`/`.glsl` → WebGL (new).

Rejected: a new `background: "shader"` enum value (needless schema surface); a new top-level motion tier (rung 2 / overkill for a backdrop).

`backgroundKeyframes`, `backgroundTriggers`, and `backgroundIntensity` already exist and flow unchanged — they become shader uniforms (see §2).

### 2. Uniform contract — kino prepends a fixed header

The agent authors **only** the ShaderToy entry point:
```glsl
void mainImage(out vec4 fragColor, in vec2 fragCoord) { ... }
```

Kino assembles the compiled source: `#version 300 es`, `precision highp float`, the uniform declarations below, a ShaderToy compatibility shim (`out vec4` sink), the agent body, then `void main(){ mainImage(outColor, gl_FragCoord.xy); }`.

| Uniform | Type | Source | Deterministic |
|---|---|---|---|
| `iResolution` | `vec3` | `(width, height, 1.0)` | — |
| `iTime` | `float` | **`frame / fps`** | ✅ frame-derived, not wall-clock |
| `iFrame` | `int` | `frame` | ✅ |
| `iTimeDelta` | `float` | `1.0 / fps` | ✅ |
| `uPulse` | `float` | `pulseAt(triggers, t)` | ✅ |
| `uColorA` / `uColorB` / `uColorC` | `vec3` | params `colorA/B/C` (hex→vec3), default brand mint / green / gold | ✅ |
| `uIntensity` | `float` | `backgroundIntensity` (or param `intensity`), default 0.5 | ✅ |
| `uParam0`..`uParam3` | `float` | first 4 numeric tweened keyframe params, in author-declared order | ✅ |

Excluded on purpose: `iDate` (wall-clock smell, unused), live `iMouse` (zeroed vec4 for ShaderToy paste-compat only). The determinism guarantee is entirely `iTime = frame/fps`, `iFrame = frame` — the same substitution the CSS and Canvas2D layers already make.

Param → uniform mapping mirrors the existing Canvas2D `brand-wash.js` convention (`colorA/B/C` + `intensity`), so authors carry one mental model across both background kinds. Numeric params beyond the named ones map positionally to `uParam0..3`; if an author needs a 5th, that is a rung-1.x follow-up, not a blocker.

### 3. Render component — `src/render/native/page/ShaderBackground.tsx`

A sibling of `CanvasBackground.tsx`, same lifecycle contract:

- Runs its per-frame work in `useLayoutEffect` (synchronous, inside the engine's `flushSync` seek) — identical capture guarantee to Canvas2D.
- **Compile once.** The program is compiled on mount and cached in a ref (memo key = assembled source). The fullscreen-quad VBO is created once. Per-frame work is only: resolve tweened params (`paramsAt`) + pulse (`pulseAt`) from the current time, set uniforms, `drawArrays`, then **`gl.finish()`** so the CDP screenshot captures a completed frame.
- WebGL2 context, `{ preserveDrawingBuffer: true }` (safety against the browser compositing a cleared buffer before the screenshot).
- On compile failure: render nothing and log a friendly error with the GLSL info-log at `frame === 0`, mirroring the Tier-2 `render(env)` throw path in `MotionGraphic.tsx`. Never throw out of the layout effect (would crash the whole page/boot).

### 4. Wiring

- `src/commands/build.ts` (~line 220): already `readFileSync`s the resolved `backgroundComponent` into `bgCustomCode`. Add the resolved kind (canvas vs shader, from extension). Carry it into props as a discriminator — e.g. set **either** `bgCustomCode` (canvas draw-fn source) **or** `bgShaderCode` (fragment source), not both.
- `src/render/native/page/components.tsx` (~line 183): today it `new Function("ctx","env", customCode)` → `<CanvasBackground>`. Branch: if `bgShaderCode` is set, mount `<ShaderBackground shaderSrc={bgShaderCode} params keyframes triggers intensity t />` instead.
- Props type (`src/render/props.ts`): add optional `bgShaderCode?: string` alongside the existing custom-background field.

### 5. Determinism rules (all already enforced elsewhere)

1. Draw completes before the screenshot — `gl.finish()` in the sync seek path (mirrors the `useLayoutEffect`/`flushSync` guarantee).
2. No wall clock / RAF / random — time comes only from `iTime`/`iFrame` (frame-derived). GLSL has no network/timer/random surface, so no JS-style denylist is needed.
3. No external assets in rung 1 (no textures/GLTF) — nothing to preload, unlike fonts/video which the engine already preloads at boot.

GPU output is not bit-identical across drivers/machines, but same-machine renders are consistent, the frame cache keys on signatures (not pixel hashes), and outputs are videos — so this is acceptable and does not weaken the cache.

## Validation & tooling

- **Lint:** near-zero. The assembled shader must compile; failure surfaces at runtime (frame 0) with the GLSL log. No determinism denylist (time is already frame-locked).
- **Library asset:** ship one reference shader `assets-lib/backgrounds/aurora-flow.frag` (a flowing gradient / plasma) — an immediately usable backdrop and the canonical example for agents, paralleling `brand-wash.js`. `kino backgrounds` lists `.frag`/`.glsl` ids alongside `.js` ones.
- **Docs:** update the background reference (`docs/` background/spec docs + `src/commands/backgrounds.ts` help text) to document the `.frag` convention and the uniform header.

## Testing

Two pure units get one test each; WebGL raster is verified by eye.

1. **Header assembly** (`assembleShaderSource(body) → string`): asserts the result contains the `#version 300 es` header, all uniform declarations, and a `main()` that calls `mainImage`. Pure, no GL.
2. **Env → uniform values** (the mapping fn used by `ShaderBackground`): asserts uniform values are a pure function of `frame` (same frame → identical values; `iTime === frame/fps`; hex params parse to the right `vec3`). Pure, no GL.
3. **Manual:** `kino still` on a project using `aurora-flow.frag` confirms the shader actually rasters (WebGL rendering is impractical to unit-test in Node).

No frameworks beyond the existing vitest setup.

## Build note

Kino runs from compiled `dist/`, not `src/` — implementation must `npm run build` before any `kino` invocation picks up the new source, and the page bundle (`scripts/build-page.mjs`) must include `ShaderBackground`.

## Deliverables

- `src/render/native/page/ShaderBackground.tsx` (new)
- `src/media/backgroundLib.ts` — extension probe for `.frag`/`.glsl`
- `src/commands/build.ts` — resolve kind, read shader source into props
- `src/render/native/page/components.tsx` — branch to `ShaderBackground`
- `src/render/props.ts` — `bgShaderCode?: string`
- `assets-lib/backgrounds/aurora-flow.frag` (new reference shader)
- `src/commands/backgrounds.ts` + background docs — document the convention
- Tests: header assembly, env→uniform mapping
