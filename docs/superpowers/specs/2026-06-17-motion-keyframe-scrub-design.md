# kino motion graphics — scrubbed `@keyframes` — design

**Date:** 2026-06-17
**Status:** approved (brainstorm) → ready for plan
**Branch:** `feat/motion-graphics` (lands on the open PR #4 alongside Tier 1)
**Builds on:** [`2026-06-16-motion-graphics-design.md`](2026-06-16-motion-graphics-design.md) (Tier 1),
[`2026-06-16-motion-graphics-research.md`](2026-06-16-motion-graphics-research.md) (the CSS-determinism fix)

## Goal

Let agents author motion graphics with ordinary CSS **`@keyframes`** — the syntax they're most fluent
in — and have them render **deterministically** inside kino's headless Remotion pipeline. Today the
determinism lint **bans** `@keyframes`/`animation` outright (because a wall-clock CSS animation
flickers under frame-seek rendering). This feature replaces that ban with the canonical Remotion
technique — **force every animation paused and drive its playhead from `--progress`** — so agents get
`@keyframes` for free without any new sandbox or JS-execution path.

This is the cheapest real capability bump on top of Tier 1: pure CSS, no agent JS, no new dependency.

## Background — why the ban exists, and the fix

Remotion renders by seeking to frame N and screenshotting. A normal CSS animation runs on the wall
clock, so it does not advance between captured frames → flicker. Remotion's documented fix
(`remotion-dev/css-animation-play-state`): keep the `@keyframes`, set `animation-play-state: paused`,
and scrub the playhead with a **negative `animation-delay`** derived from the frame. We generalize
that so kino owns the pause + delay and the agent just writes the animation.

## The contract (one sentence)

> The agent writes normal `@keyframes` and marks animated elements with `class="kino-anim"`; kino
> force-pauses **all** animations (so nothing can run on the wall clock) and scrubs `.kino-anim`
> elements across the beat via a `--progress`-driven negative `animation-delay`. Determinism is
> guaranteed by the render, not by forbidding the feature.

## Design

### 1. Injected scrub stylesheet (kino-owned)

`MotionGraphic`'s shadow injection prepends this constant, trusted stylesheet into **every** motion
graphic's shadow root (it is inert for graphics that define no animations):

```css
/* nothing runs on the wall clock — determinism guaranteed */
* { animation-play-state: paused !important; }
/* a marked element's animation is scrubbed across the beat by --progress */
.kino-anim {
  animation-duration: 1s !important;     /* normalize: the whole beat == 1s of animation */
  animation-fill-mode: both !important;   /* hold the 0% pose before, the 100% pose after */
  animation-iteration-count: 1 !important;
  animation-delay: calc((var(--progress) - var(--kino-delay, 0)) * -1s) !important;
}
```

- `--progress` is already set on the host element every frame (Tier 1) and inherits across the shadow
  boundary, so the scrub is a pure function of `useCurrentFrame()`.
- `--kino-delay` (agent-set, **default 0** via the `var(…, 0)` fallback) shifts an element's start
  later — the stagger lever. It composes with the existing `sibling-index()` recipe:
  `--kino-delay: calc((sibling-index() - 1) * .1)`.
- Easing is the **agent's** to control via their `@keyframes` % stops and `animation-timing-function`
  (both deterministic under scrub) — kino does not force a timing function.

### 2. The agent's authoring surface

```css
@keyframes pop { 0% { transform: scale(.6); opacity: 0 }
                 60% { transform: scale(1.06) }
                 100% { transform: scale(1); opacity: 1 } }
.badge { animation-name: pop; }
```
```html
<div class="badge kino-anim">NEW</div>
```

- The animation plays its `0% → 100%` across the **whole beat**. Sub-timing (delays, holds) is baked
  into the keyframe **percentages** (e.g. nothing moves until `30%`, settle by `70%`, hold to `100%`).
- To reveal items one-after-another, set `--kino-delay` per element (often via `sibling-index()`).
- The agent **must not** set `animation-play-state` (kino manages pausing — see the lint).

### 3. Lint changes ([`src/render/motiongraphic.ts`](../../../src/render/motiongraphic.ts))

In the `BANNED` array:

- **Remove** the `@keyframes` rule (now allowed).
- **Replace** the broad `animation(-\w+)?\s*:` rule with a **narrow ban on `animation-play-state`**
  only, message: *"animation-play-state is managed by kino — mark the element `class=\"kino-anim\"`;
  don't override the pause."* (This is the one declaration that could defeat determinism: an agent
  `!important` `running` could beat kino's global `*` pause, so it must be rejected at lint time.)
- **Keep** `transition(-\w+)?\s*:` banned — transitions fire on wall-clock state changes and have no
  pause/scrub equivalent.
- **Keep** everything else unchanged: `<script>`, `on*=`, SVG SMIL, `requestAnimationFrame`/timers,
  `Date.now`/`Math.random`, `fetch`/`XMLHttpRequest`, external `url(...)`, `@import`.

Determinism guarantee after this change = **render force-pauses all animations** (handles the common
case incl. defaults) **+ lint forbids `animation-play-state`** (prevents the one override that could
un-pause). Together: airtight.

### 4. Render change ([`src/render/remotion/MotionGraphic.tsx`](../../../src/render/remotion/MotionGraphic.tsx))

`ShadowHtml` currently does `shadowRef.current.innerHTML = html`. Change to prepend a module-level
constant `KINO_SCRUB_STYLE` (a `<style>…</style>` string holding the §1 CSS):
`shadowRef.current.innerHTML = KINO_SCRUB_STYLE + html`. The kino style is trusted (authored by kino,
not the agent) so it is **not** run through DOMPurify. No other component changes; `--progress` /
`--kino-delay` resolution is unchanged.

### 5. Docs

- **`kino motion`** ([`src/commands/motion.ts`](../../../src/commands/motion.ts)) gains a "Scrubbed
  `@keyframes`" section: the `@keyframes` + `class="kino-anim"` pattern, "sub-timing goes in the %
  stops," stagger via `--kino-delay`, and "don't set `animation-play-state`."
- **SKILL.md** ([`skills/video-production/SKILL.md`](../../../skills/video-production/SKILL.md)) — one
  line in the motion bullet pointing at the scrub pattern.

### 6. Testing ([`tests/motiongraphic.test.ts`](../../../tests/motiongraphic.test.ts), `tests/render-motion.test.ts`)

- **Lint (intentional behavior change — not a regression).** Several existing assertions flip because
  `@keyframes` and `animation`/`animation-name`/`animation-duration`/`animation-delay` are now
  **allowed** (only `animation-play-state` remains banned). Concretely, in the current tests:
  - "rejects `@keyframes`" → now asserts `@keyframes` produces **no** violation.
  - "rejects CSS animation" / the `animation:spin 1s` and `animation-name:…;animation-delay:…` cases →
    now assert these produce **no** violation.
  - **Add** a case asserting `animation-play-state: running` **is** rejected (with the kino-managed
    message).
  - **Keep** the `transition` / `transition-*` rejection and the SVG SMIL rejection unchanged.
- **Render (verifies the core assumption):** a `.kino-anim` element animating a measurable property
  (e.g. `@keyframes slide { from { left: 0 } to { left: 800px } }`) renders **different** positions at
  an early frame vs. a late frame (scrub works), and renders **identically** across two renders of the
  same frame (deterministic). This pins down that paused + negative-`animation-delay` actually scrubs
  in Remotion's headless Chromium.

## Scope

**In scope:** the injected scrub stylesheet, the `.kino-anim` class + `--kino-delay` stagger, the lint
relaxation (allow `@keyframes`, ban `animation-play-state`, keep `transition` banned), the render
injection, docs, and tests.

**Out of scope (unchanged from Tier 1's deferred list):** `@remotion/lottie`, agent JS (`new Function`
/ iframe tiers), anime.js / GSAP engines, `@remotion/three`/WebGL, Rive. CSS `transition` stays
banned. Per-element explicit animation **windows** (start+duration) are deferred — v1 normalizes every
scrubbed animation over the whole beat; sub-timing is expressed in keyframe %.

## Compatibility & risk

- **Backward compatible:** existing motion graphics (the Tier 1 examples) use CSS variables and define
  no `@keyframes`/`animation`, so the global `*{animation-play-state:paused}` is a no-op for them.
- **One assumption to verify in implementation:** that a paused animation with a negative
  `animation-delay` renders the scrubbed pose in Remotion's headless Chromium. It's the documented
  Remotion technique and the §6 render test verifies it directly — if it somehow fails, that test goes
  red before anything ships.
