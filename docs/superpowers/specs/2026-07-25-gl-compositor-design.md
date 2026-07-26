# Full-frame WebGL compositor — spike + core

**Date:** 2026-07-25
**Status:** implemented — phases 1–4 complete, DOM path removed
**Scope:** sub-projects 0 (raster spike) and 1 (compositor core). Masks, effects, post FX and DOM
retirement are named here but specified separately.

## Why

kino composites frames in DOM. Chromium lays out a React tree, rasterizes it, and the engine grabs
the result with a per-frame CDP screenshot. WebGL exists only as islands: the shader background
(`ShaderBackground.tsx`), per-beat region shaders (`RegionShader.tsx`), and the per-element liquid
glass mirrors (`liquidGlass.ts`).

That shape caps four things at once:

- **Masking is not a layer property.** Masks exist inside the region-shader beat kind and nowhere
  else. There is no way to say "mask this caption against that footage".
- **Effects can only see their own island.** `registerBackdrop` hands the glass runtime whatever
  background layer drew last — never the video, cutaway or text above it. Glass over footage is
  currently impossible, not merely unimplemented.
- **There is no full-frame post stage.** Grade, bloom, lens distortion and shader transitions have
  to be faked per layer in CSS.
- **Two pixel paths.** DOM raster and GL islands diverge independently across gpu/swiftshader and
  across machines, and each needs its own parity story.

A compositor where every layer is a texture collapses all four into one problem.

## Non-goals

- Changing the authoring surface. Every existing spec must render unchanged; motion graphics stay
  sanitized HTML/CSS in a shadow root, captions stay styled text.
- Implementing masks, effects or post FX. Phase 1 builds their seam and leaves them no-ops.
- Deleting the DOM path. It survives as the parity reference through phase 1.
- Byte-identical output with the DOM path. Not achievable — see "Parity is perceptual" below.

## Decomposition

| # | Sub-project | Specified |
|---|---|---|
| 0 | Raster spike — measure before committing | this document |
| 1 | Compositor core — layer graph, GL renderer, providers, at parity | this document |
| 2 | Masks and per-layer effects | later |
| 3 | Full-frame post FX and shader transitions | later |
| 4 | Perf work and DOM-path retirement | later |

Sequencing is parity-first: phase 1 ships nothing user-visible and is gated behind
`KINO_COMPOSITOR=1` until frames match. Phases 2–4 are only worth designing once the core's real
costs are known.

## Architecture

The React tree stops being the compositor and becomes a **hidden staging DOM**. The only visible
element is one `<canvas id="kino-stage">` holding a WebGL2 context created with
`{preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false}` — the convention already
used in `RegionShader.tsx` and `liquidGlass.ts`.

The seek contract splits into two strict phases. Today resolve and paint are entangled inside
`flushSync` plus `settleImages`:

```
kinoSeek(n)
  ── phase A: RESOLVE (async) ──────────────────────
     layersAt(props, n) → LayerDraw[]          pure, node-testable
     for each draw: provider.textureFor(n)     may raster / decode / await
     await all                                  (replaces settleImages)
  ── phase B: DRAW (sync, no awaits) ───────────────
     reset GL state → SS× FBO
     back-to-front: bind texture, quad transform, blend, per-layer effects
     present: FXAA + downsample → default framebuffer → gl.finish()
```

Nothing in phase B touches CSS, layout or the network. Chromium never composites a frame again; it
only rasterizes source material during phase A.

## Layer model

The graph mirrors the stack documented at the top of `KinoVideo.tsx`. This is a port, not a
redesign.

```ts
interface LayerDraw {
  id: string;                       // stable → cache key, debuggable
  source: TextureRef;               // provider + per-frame key
  rect: { x: number; y: number; w: number; h: number };  // frame px
  transform: { scale: number; rotate: number; translate: [number, number] };
  opacity: number;
  blend: "normal" | "screen" | "multiply" | "add";
  effects: EffectRef[];             // empty in phase 1 — the phase-2 seam
  mask?: MaskRef;                   // unused in phase 1 — the seam exists
}
```

`layersAt(props, frame)` is a pure function. The `Sequence` / `interpolate` math currently expressed
in JSX moves into it, so beat windows, crossfade opacities and push-in scales become unit-testable
numbers rather than things only verifiable by rendering a PNG.

**Transform animation is hoisted out of the raster and onto the GL quad.** A word caption's
scale/opacity pulse becomes `transform` and `opacity` on the layer; only the text *content* is
rasterized, cached by `(text, activeWordIndex)`. Captions therefore re-raster roughly once per word
instead of once per frame — faster than today, not slower. The same hoist applies to the avatar
push-in, cutaway transitions and logo tweens.

## Texture providers

One interface, six implementations. Each answers "give me the texture for frame *n*" and declares
whether it needs an await.

| Provider | Source | Cost per frame | Notes |
|---|---|---|---|
| `shader` | existing `assembleShaderSource` program | draw only | renders into the graph's FBO instead of its own canvas; FXAA/SS move to `present` |
| `canvas2d` | background presets (`DrawFn`) | draw + upload | offscreen canvas → `texImage2D` |
| `region` | existing RegionShader program | draw only | ported as-is; its masks pre-empt phase-2 work |
| `frames` | pre-extracted video stills (`<img>`) | upload | no raster — direct `texImage2D(img)`; covers avatar windows and cutaway footage |
| `image` | logo, static images | upload once | cached for the run |
| `html` | `buildTemplate` + `rasterAt` from `bgTextures.ts` | serialize + data-URL + decode | the expensive one |

Video and images — the majority of pixels in a typical build — bind directly. Only motion graphics
and text go through `html`.

The `html` provider reuses the existing raster infrastructure rather than reinventing it:
`bgTextures.ts` already inlines brand fonts as data URLs, uses data-URL (not blob) SVGs to avoid
canvas taint under `texImage2D`, handles fixed-box versus `fit-content` measurement, and LRU-caches
by scrub key.

## Raster policy

Each `html` layer resolves to one of three cadences, decided statically at load:

- **`static`** — rasterized once. No `--frame` / `--t` / `--progress` / `--pulse` in its CSS, no
  Tier-2 JS, no `--word` binding.
- **`keyed`** — rasterized per distinct content key, LRU-cached. Captions keyed by active word;
  kickers and text overlays keyed by content.
- **`dynamic`** — rasterized every frame. Motion HTML whose CSS reads frame vars, or that runs
  Tier-2 JS.

Classification is a static scan of the sanitized markup plus the presence of a Tier-2 evaluator,
backed at runtime by a `MutationObserver` on the shadow root as a dirty check. Misclassifying
`dynamic` as `keyed` is the only dangerous direction — a frozen layer renders silently wrong — so
the scan errs toward `dynamic` and the classifier is unit-tested on that property.

## Three fidelity traps

These are the reasons the spike is not optional.

**1. `<canvas>` inside motion HTML serializes empty.** `XMLSerializer` emits the element, not its
pixels, so a Lottie layer — which renders into a canvas inside the shadow root — would silently
vanish from the frame. Fix: canvases inside a rasterized subtree are lifted out as their own
`LayerDraw` with a direct-upload provider, positioned by their measured rect. Lottie stops being an
HTML layer entirely, which is also faster.

**2. SVG-as-image cannot load external resources.** An `<img src="/public/shot.png">` or a
`background: url(...)` inside motion HTML will not load inside the `foreignObject` raster; it
disappears with no error. Fonts already dodge this through `fontFaceCss` inlining. Images do not.
Fix: a pre-pass (`inline.ts`) that rewrites every external reference in the staged subtree to a data
URL before serializing. This is real work and a real risk to existing specs — the trap most likely
to make phase 1 longer than planned, which is why M4 below sizes it before the port starts.

**3. Parity is perceptual, not byte-exact.** GL blending and Chromium's rasterizer disagree on
antialiased edges and subpixel text. Any gate written as `diff === 0` against the DOM path would be
unmeetable; the harness uses a mean-absolute-difference threshold instead. Byte equality is still
required *within* the compositor path — same frame twice must be identical.

## Capture, color and cache

- **Capture** stays `page.screenshot({type: "jpeg", quality: 95})` for phase 1. The page is now a
  single canvas, so it is a cheaper raster than today's layer tree, and `preserveDrawingBuffer: true`
  makes a post-draw grab valid outside a rAF. `readPixels` plus transfer is benchmarked in the spike
  (M5) but not adopted before phase 4.
- **Blending happens in sRGB, not linear.** Matching CSS compositing semantics is a hard requirement;
  linear blending would shift every existing spec. Uploads are premultiplied
  (`UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`) and blended with `(ONE, ONE_MINUS_SRC_ALPHA)`.
- **Frame cache** gains `compositor: boolean` in `globalSig` with a `VERSION` bump in
  `frameCache.ts`, so DOM-path and compositor frames can never cross-serve. This matters
  immediately: the flag makes both paths reachable on one machine.
- **Supersampling moves up** from per-shader to per-composite: the graph renders at SS×, and FXAA
  plus downsample happen once at `present`. Cleaner, but it means `html` rasters are requested at SS×
  too — a cost M2 measures at both SS=1 and SS=2. **Phase 1 does not make this move.** Relocating SS
  changes shader pixels, and phase 1's only job is parity, so the shader and region providers keep
  their existing per-source SS/FXAA resolve and the composite-level move lands in phase 4 alongside
  the other perf work.

## The mask and effect seam

`MaskRef` and `EffectRef` exist in the layer type and are threaded through the renderer as no-ops in
phase 1. This costs almost nothing now and lets phase 2 add mask sources — alpha, luma, the existing
`kinoMaskDist` SDF frames from `sdfFrames.ts`, shape SDFs — without reshaping the graph.

The glass runtime is the proof case. Once every layer is a texture, `registerBackdrop` stops meaning
"whatever background drew last" and becomes "the true composite beneath this layer". The current
limitation disappears as a side effect of the port rather than as a feature.

## Sub-project 0 — the spike

A throwaway branch, not production code, producing
`docs/superpowers/specs/2026-07-25-gl-compositor-spike-REPORT.md` (dated the day it runs).

| # | Measurement | Method |
|---|---|---|
| M1 | Baseline per-frame wall time on the DOM path | instrument the engine on two real specs: a typical build and a motion-heavy worst case |
| M2 | `html` raster cost | `buildTemplate` + `rasterAt` p50/p95 for a full-screen motion graphic and a caption line, at SS=1 and SS=2, 1080×1920 |
| M3 | Raster fidelity | `foreignObject` raster versus DOM screenshot of the same subtree — `meanDiff`, plus visual inspection of text edges |
| M4 | Blast radius of trap 2 | static scan of `examples/`, `demos/`, `projects/`, `assets-lib/` for external references inside motion HTML |
| M5 | Capture path | `readPixels` plus transfer versus CDP JPEG, per frame |
| M6 | Color and alpha parity | text and a gradient over a background, GL composite versus DOM composite |

**Decision criteria, fixed before the numbers arrive:**

- **Proceed** if projected compositor per-frame time is ≤ 1.25× baseline on the worst-case spec and
  ≤ 1.0× on the typical one, and M3 shows no visible text degradation.
- **Redesign** if dynamic full-screen raster dominates. The fallback is narrowing what qualifies as
  `dynamic` — author-facing constraints on frame-var usage in motion HTML — not abandoning the
  compositor.
- **Stop** if M6 shows color or alpha differences that cannot be reconciled, since every existing
  spec would shift.

## Testing the core

- **Node-side unit tests for `layersAt`** — beat windows, crossfade opacities, push-in scales,
  chained-cutaway extension. Currently only verifiable by rendering a PNG.
- **Unit tests for the raster-policy classifier**, including the errs-toward-`dynamic` property.
- **Parity harness** — `tests/render-compositor-parity.test.ts`, following the `magick` `meanDiff`
  pattern from `tests/render-glass.test.ts`. Canonical frames from a coverage matrix hitting every
  provider: shader background, canvas2d background, region shader, video cutaway, static motion HTML,
  dynamic motion HTML, word captions, hero caption, logo, Lottie, glass, film finish. Gate:
  `meanDiff ≤ 0.01` against the DOM path.
- **Determinism** — same frame rendered twice, `meanDiff === 0`, per the existing pattern.
- **Visual review** with the `adversarial-critique` skill on a real build before the flag flips.
  Thresholds will not catch a caption that sits 3px off.

## Rollout and file layout

`KINO_COMPOSITOR=1`, off by default throughout phase 1. Both paths coexist, and `KinoVideo.tsx`
stays untouched as the reference implementation — it is what parity is measured against, so it must
not be edited during the port. The default flips after parity plus visual review. The DOM path is
deleted in phase 4, not before.

```
src/render/layers.ts                  layersAt(props, frame) — pure, node-testable
src/render/native/page/compositor/
  Stage.tsx        canvas + hidden staging DOM
  graph.ts         LayerDraw / MaskRef / EffectRef types
  renderer.ts      GL quads, blend, FBO ping-pong, present
  rasterPolicy.ts  static | keyed | dynamic classifier
  inline.ts        external-resource → data URL pre-pass
  providers/       shader · canvas2d · region · frames · image · html
```

`layers.ts` sits outside `page/` so node tests can import it without a browser.

## Risks

| Risk | Mitigation |
|---|---|
| Per-frame raster makes rendering slower, not faster | M1/M2 measure it before any port work; hoisting transform animation onto the quad removes the caption case entirely |
| External references vanish from motion HTML rasters | M4 sizes the blast radius; `inline.ts` is scoped as part of phase 1, not an afterthought |
| Lottie and nested canvases render empty | canvases are lifted to their own direct-upload layers |
| Color or alpha shift across every existing spec | sRGB blending is a stated requirement; M6 gates it, and the parity harness covers every provider |
| Scope creep from phases 2–4 into the core | masks and effects are seams only; the flag stays off until parity holds |

## Implementation notes

The CLI runs compiled `dist/`, not `src/` — `npm run build` after source edits, or new fields are
silently stripped.
