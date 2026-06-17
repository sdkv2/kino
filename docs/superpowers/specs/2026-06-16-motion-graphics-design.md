# kino motion graphics (Tier 1) — design

**Date:** 2026-06-16
**Status:** approved (brainstorm) → ready for plan
**Branch:** `feat/motion-graphics`
**Research:** [`2026-06-16-motion-graphics-research.md`](2026-06-16-motion-graphics-research.md)

## Goal

Let a driving agent add **clean, custom motion graphics** to a kino video by writing a
self-contained **HTML/CSS file** (a surface agents are fluent in), while the **JSON spec keeps full
control of timing, parameters, and triggers**. The graphic renders deterministically inside kino's
existing Remotion → MP4 pipeline.

This is **Tier 1** of a larger architecture (see research note): static HTML/CSS bound to kino-set
CSS variables. Later tiers (procedural `new Function` HTML, iframe isolation, Lottie, JS animation
engines, 3D) are explicitly **out of scope here** and documented in the research note so they extend
rather than rediscover this work.

## The contract (one sentence)

> The agent's HTML/CSS file is a **stateless canvas**. Each frame kino reads `useCurrentFrame()`,
> computes a set of **CSS custom properties** from the JSON spec, sets them on the file's root, and
> the agent's CSS animates by reading those variables. Time only ever flows from kino.

This is a direct generalization of kino's existing `custom` faceless background
(`new Function("ctx","env",code)` run per-frame against `env.frame` + `paramsAt()` keyframes — see
[`src/render/remotion/backgrounds/CanvasBackground.tsx`](../../../src/render/remotion/backgrounds/CanvasBackground.tsx)
and [`src/render/bgparams.ts`](../../../src/render/bgparams.ts)) — emitting **DOM + CSS variables**
instead of Canvas2D paints, and reusing the same keyframe machinery.

## Scope

**In scope (v1):**

- A new `motion` **segment kind** — a full-screen motion-graphic beat that composes in the timeline
  exactly like `avatar`/`app` beats (VO continues over it).
- A `motionOverlay` field on `avatar`/`app` segments — the same graphic layered **on top of** that
  beat (like captions/kickers/logo).
- Both render through **one** kino-owned `MotionGraphic` component.
- Agent authors a **referenced HTML file** (`assets/motion/*.html`); JSON references it and supplies
  `params` / `keyframes` / `triggers`.
- Motion expressed **only** via kino-set CSS variables. **No agent JS. No `@keyframes`. No
  `transition`.** (Decision A.)
- `motion` segments are **VO-timed** — they carry spoken `text`; duration comes from the generated
  VO, identical to other beats. (Decision B.)
- Build-time **sanitization + determinism lint** of the agent file; **fast preview** via the
  existing `kino still`/`storyboard`.

**Out of scope (deferred — see research note):**

- Tier 2 (procedural `render(frame, params)` JS via `new Function`).
- Tier 3 (`<iframe srcDoc>` isolation).
- `@keyframes` via the paused + negative-`animation-delay` scrub (fast-follow to Tier 1).
- `@remotion/lottie` (phase 2), GSAP/anime.js engines, `@remotion/three`/WebGL, Rive.
- Silent motion stings with explicit `durationSec` (would need VO-track silence insertion).

## Spec schema

Reuses the **existing** `BgKeyframe` / `BgTrigger` types (`at` / `params` / `ease`, and `at` /
`action`) and the `paramsAt` / `pulseAt` resolvers — no new keyframe system.

```jsonc
// New full-screen beat — composes like avatar/app in the timeline:
{ "kind": "motion",
  "source": "motion/stat-card.html",            // path under assets/ (project assets/ if in a project)
  "text": "...",                                 // spoken VO → drives this beat's duration
  "caption": "...",                              // optional; existing caption system applies
  "captionMode": "words",                        // optional; same as other beats
  "params":    { "pct": 0, "accent": "mint" },   // base CSS-variable values
  "keyframes": [ { "at": 0.2, "params": { "pct": 86 }, "ease": "overshoot" } ],
  "triggers":  [ { "at": 0.2, "action": "pulse" } ] }

// OR attach the same graphic as an overlay on an existing beat:
{ "kind": "app", "asset": "screens/x.png", "text": "...", "caption": "...",
  "motionOverlay": {
    "source": "motion/callout.html",
    "params": { "x": 50 }, "keyframes": [...], "triggers": [...] } }
```

Schema additions in [`src/spec/schema.ts`](../../../src/spec/schema.ts):

- A `MotionGraphicRef` object: `{ source: string, params?: Record<string,number|string>,
  keyframes?: BgKeyframe[], triggers?: BgTrigger[] }`.
- A third member of the `Segment` discriminated union: `kind: "motion"` = `MotionGraphicRef` +
  `text` (min 1, like other beats) + optional `caption` / `captionMode` / `emphasis` /
  `captionKeyframes`.
- An optional `motionOverlay: MotionGraphicRef` on the `avatar` and `app` members.

The overlay is a **full-frame layer the agent positions with its own CSS** (consistent with captions
sitting at fixed coordinates) — no positioning schema in v1.

**File format.** `source` points at a **single self-contained `.html` file**: markup plus one inline
`<style>` block. No separate `.css` file, no external links. kino reads it, sanitizes/lints it, and
injects it into the graphic's Shadow DOM root.

## The CSS-variable contract (the agent-facing API)

kino sets these custom properties on the graphic's root **every frame**. This is the entire surface
agents code against:

| Variable | Meaning |
|---|---|
| `--frame` | integer frame within the beat |
| `--t` | seconds within the beat |
| `--progress` | `0 → 1` across the beat's duration |
| `--<param>` | every key in `params`, tweened by `keyframes` (e.g. `--pct`, `--accent`) |
| `--pulse` | `0 → 1` envelope from `triggers` (reuses `pulseAt`) |
| `--kino-green` / `--kino-night` / `--kino-white` / `--kino-mint` | brand palette (from `Theme`) |
| `--kino-font` | brand font family |

The agent writes ordinary CSS against them, e.g.:

```css
.bar    { width: calc(var(--pct) * 1%); background: var(--kino-mint); }
.title  { transform: translateY(calc((1 - var(--progress)) * 40px));
          opacity: var(--progress); font-family: var(--kino-font); }
```

Numeric variables are registered via the CSS `@property` at-rule (type `<number>`) so they animate
as numbers, not strings. kino injects these `@property` declarations; the agent does not write them.

## Architecture

**New files:**

- [`src/render/motiongraphic.ts`](../../../src/render/motiongraphic.ts) — **pure, testable**. Reads
  the referenced file, **sanitizes + lints** it (below), returns a clean HTML string. Also resolves
  which CSS variables a graphic declares (for the build to bake in).
- [`src/render/remotion/MotionGraphic.tsx`](../../../src/render/remotion/MotionGraphic.tsx) — the
  render component. Per frame: `useCurrentFrame()`/`useVideoConfig()` → resolve params via the
  existing `paramsAt(params, keyframes, t)` and pulse via `pulseAt(triggers, t)` → compute
  `--frame`/`--t`/`--progress` and one `--<name>` per param + the brand vars → set them on a host
  `<div>` → inject the sanitized HTML into a **Shadow DOM root** on that div. Custom properties
  inherit across the shadow boundary, so the agent's (shadow-scoped) CSS reads them while its own CSS
  cannot leak into kino's caption/background layers.

**Wiring:**

- [`src/render/props.ts`](../../../src/render/props.ts) — carry the resolved (sanitized HTML +
  params/keyframes/triggers) for each motion segment/overlay into `KinoProps`.
- [`src/render/remotion/KinoVideo.tsx`](../../../src/render/remotion/KinoVideo.tsx) — render a
  `motion` segment as a `<Sequence>` containing `<MotionGraphic>` (+ its caption, reusing the
  existing caption path); render a `motionOverlay` as a `<MotionGraphic>` layered inside the host
  segment's `<Sequence>`, above the app/avatar like the kicker overlay.
- [`src/spec/validate.ts`](../../../src/spec/validate.ts) — confirm every `source` file exists and
  passes sanitization/lint; **fail the build with a clear message** (same posture as `bannedPhrases`).

**Duration / timeline:** unchanged. A `motion` segment carries `text`, so it flows through the
existing VO → word-timing → `startSec`/`endSec` machinery exactly like `avatar`/`app` beats.
`--progress` maps `0→1` across that window.

**Preview:** unchanged tooling. `kino still` / `kino storyboard` render the composite via Remotion
`renderStill`, so motion graphics appear in the existing fast, free iterate loop.

## Determinism + security enforcement (one mechanism, two wins)

Because Tier 1 motion comes **only** from CSS variables, v1 forbids agent JS entirely — which makes
each graphic both deterministic and far easier to secure. The build-time check in `motiongraphic.ts`:

1. **DOMPurify** (Node + jsdom) with a locked allowlist of tags, attributes, and CSS properties.
   The allowlist **includes `<style>`** (the agent's inline stylesheet is the whole point) but
   strips `<script>`, `on*=` handlers, `javascript:` and remote URLs. The determinism lint (step 2)
   scans the `<style>` CSS for banned constructs.
2. **Determinism lint** — reject any of: `@keyframes`, `transition` / `transition-*`,
   `animation` (self-cycling), `requestAnimationFrame`, `setInterval`/`setTimeout`, `Date.now`,
   `Math.random`, `fetch`/`XMLHttpRequest`, remote `url(...)`. Each rejection's message points the
   agent at the CSS-variable approach.
3. **Local assets only** — image refs must be `staticFile`-able paths under assets/, or inline
   `data:` URIs.

Trust model: agent-authored HTML is **sanitized + linted** (less trusted); brand `custom`
backgrounds remain trusted local config (unchanged). A render-time network egress lock is noted as a
defense-in-depth enhancement in the research note but is **not required** for v1 (the lint already
removes remote refs, and the headless browser holds no user data).

## Agent authoring experience

- **`kino motion`** command (mirrors `kino backgrounds` / `kino elements`) — prints the CSS-variable
  contract + the determinism rules + lists the shipped example templates. New file
  [`src/commands/motion.ts`](../../../src/commands/motion.ts), registered in
  [`src/cli.ts`](../../../src/cli.ts).
- **Example templates** shipped under `assets/motion/` (referenceable, copy-and-adapt):
  a **stat card** (count-up + bar via `--pct`/`--progress`), a **kinetic title card** (word reveal
  via `--progress`), a **lower-third callout** (for the overlay path). These are the fastest route to
  correct output and double as render-test fixtures.
- **SKILL.md** gains a "Motion graphics" section: the contract, the rules, and "copy a template".
  Load-bearing at the point of use.

## Testing (vitest)

- **Unit (`motiongraphic.test.ts`):** sanitizer strips `<script>`/handlers/remote refs; lint rejects
  each banned construct with the right message; a clean template passes untouched.
- **Unit (schema/validate):** `motion` segment + `motionOverlay` parse; missing `source` file fails
  validation; a banned-construct file fails the build.
- **Resolver:** CSS-variable values at a given frame match `paramsAt`/`pulseAt` expectations.
- **Render:** a still of the stat-card template at a known frame renders deterministically (same
  frame rendered twice → identical), and a known `--progress` yields the expected computed style.

## Open items

- **Remotion licensing** (free for individuals/small teams; paid Company License at scale) — the one
  non-OSS dependency in the stack; confirm against kino's commercial setup. Unchanged by this work
  (kino already depends on Remotion).
- The deferred tiers' spikes (GSAP/anime `.seek()` synchronicity; iframe per-frame `srcDoc`) are
  **not** needed for v1 — Tier 1 depends on neither.

## Future phases (recorded, not built now)

1. `@keyframes` support via paused + negative-`animation-delay` scrub (the canonical Remotion fix).
2. `@remotion/lottie` — reference + frame-map a `.lottie/.json`, with a no-expressions/offline-assets
   validator; then JSON-driven color/text param overrides.
3. Tier 2 procedural `render(frame, params)` HTML via `new Function` (reuse the custom-background
   machinery) for loops/generative layout.
4. Tier 3 `<iframe srcDoc sandbox>` isolation fallback; GSAP/anime engines (paused + `.seek`);
   `@remotion/three`/GLSL for 3D + shaders (needs a `--gl` backend + leak mitigation).
