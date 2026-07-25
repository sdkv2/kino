# Phase 3 — region shader params + keyframes — report

Branch `feat/region-params`, off `feat/segmentation`.
Design: `2026-07-25-region-params-design.md`. Plan: `../plans/2026-07-25-region-params.md`.

## Schema

```jsonc
"regionShader": {
  "mask": "masks/clip",
  "subject": "rim.frag",
  "background": "wash.frag",
  "params":    { "rim": 2.0, "colorA": "#80e2b4" },
  "keyframes": [ { "at": 0, "params": { "rim": 2.0 } },
                 { "at": 1.2, "params": { "rim": 14.0 }, "ease": "easeInOut" } ]
}
```

`params` + `keyframes` sit on `regionShader` itself — ONE set shared by the top-level `subject`, the
`background`, and every `masks[].subject`. `keyframes` reuses the existing `BgKeyframe` shape
verbatim. This is the recommended schema, adopted unchanged: all bodies compile into a single
program with a single `uParam0..3` bank, so per-entry sets would need per-entry banks and would
exhaust the slots on the first two-mask spec.

The `regionShader` object is now `.strict()`. It was NOT before — see "found wrong" below.

## Timing: beat-relative

`at` is seconds from THIS beat's start, matching `zoomKeyframes`/`captionKeyframes`.

This turned out to be not merely the better idiom but the one the component already implements.
`RegionShader` is mounted inside `<Sequence from={f(s.startSec)}>` (`KinoVideo.tsx:75`), and
`Sequence` rebases the clock (`runtime.tsx`: `<FrameCtx.Provider value={frame - from}>`). So
`useCurrentFrame()` inside `RegionShader` is ALREADY beat-relative, and the pre-existing
`iTime = frame / 30` is already a beat-local clock. Beat-relative keyframes are therefore literally
`paramsAt(params, keyframes, frame / 30)` — zero new plumbing.

Absolute timing would have been the expensive option: it needs `startSec` threaded in as a new prop,
and it would leave `iTime` and `u_<name>` on two different clocks inside the same shader — a
guaranteed authoring trap. `backgroundKeyframes` are absolute only because a background spans the
whole video; a `regionShader` belongs to one beat, and beat-relative is what lets a track keep riding
real VO timing when an earlier beat shifts.

## Triggers / `uPulse`: not this phase (YAGNI)

No `regionShader.triggers`. Nothing in the roadmap or in any shipped `.frag` needs a one-shot yet,
and it would be a second timing concept to document and test for zero callers. `uPulse` is declared
in the region header and is now uploaded explicitly as `0` (previously it was simply never uploaded
and read 0 by GL default), so a body referencing it reads a defined value. Because the object is
strict, `triggers` is a *rejected* key rather than a silently stripped one — a spec reaching for it
fails loudly instead of rendering an unexplained still. When a one-shot is actually needed,
`pulseAt(triggers, frame/30)` drops in beside the existing `paramsAt` call.

## The 4-slot ceiling across multiple bodies

`EXTRA_PARAM_SLOTS` stays 4 and `extraParamNames` is unchanged. Because the bank is shared, the cap
is on the UNION of numeric non-reserved names across `params` and every keyframe, for the whole beat
— not per body. Four named numbers, plus `colorA`/`colorB`/`colorC`/`intensity` which drive their own
uniforms and cost no slot.

`extraParamNames` silently `slice`s past 4. For a background that means a fifth param quietly does
nothing in one body; on a shared bank it means it quietly does nothing in up to six bodies at once.
That is a bad failure mode on a brand-new surface, so the schema now `.refine()`s the union count and
errors with the offending names. `extraParamNames` itself was deliberately left alone — backgrounds
keep their current truncating behaviour, which is not this phase's to change.

The cap lives in the zod schema rather than `build.ts` because that is the smallest testable place:
`resolveRegionShader` is a private function needing a `Project` and a `stageAsset` callback, whereas
the schema is already exercised by `tests/segment-regionshader-schema.test.ts` with no fixtures.
`schema.ts` already imports from `../render/`, so importing `EXTRA_PARAM_SLOTS` introduces no new
layering violation and no cycle (`shaderSource.ts` is GL-free and dependency-free).

## What was tested, and proof it bites

`tests/render-region-params.test.ts` — a real render, not a string assertion. One beat that **starts
at 2s** (so beat-relative and absolute timing disagree and the test can tell them apart), `lift`
tweened 0→1 over beat-relative 0..1s, subject body emitting `vec4(vec3(u_lift))`, background body a
constant blue control. Three composition frames are read: 60 / 75 / 90 = beat t 0 / 0.5 / 1.0.

Working implementation:

```
subject:    t0 = 0,0,0    t0.5 = 0.501961,0.501961,0.501961    t1 = 1,1,1
background: t0 = 0,0,1                                          t1 = 0,0,1
```

Each assertion was then verified by breaking exactly what it guards, one at a time, reverting after
each:

| # | Deliberate break | Observed | Which assertion fired |
| --- | --- | --- | --- |
| A | `gl.uniform1f(loc.uParam0, 0)` — kill the upload | t0=0, t0.5=0, t1=0 | `expected 0 to be greater than 0.98` |
| B | `paramsAt(..., frame/30 + 2)` — absolute clock | t0=**1**, t1=1 | `expected 1 to be less than 0.02` |
| C | pass `region.params` raw — no tween at all | t0=0, t0.5=0, t1=0 | `expected 0 to be greater than 0.98` |
| D | `paramsAt(..., Math.floor(frame/30))` — step, not tween | t0=0, t0.5=**0**, t1=1 | `expected 0 to be greater than 0.45` |

Break D is the one that matters most: the endpoints still pass, so **only** the midpoint assertion
catches it. That is what proves the midpoint is independently load-bearing rather than decoration —
break C alone would have left the midpoint untested, since it also trips an endpoint. Break B is
what proves the test can actually detect an absolute clock; without the 2s beat offset it could not,
because at `startSec = 0` the two clocks are identical.

Also covered:

- **Back-compat, byte-for-byte.** `tests/segment-regionshader-src.test.ts` asserts with `toBe` that
  `assembleRegionShaderSource(SUBJ, BG, extraParamNames({}, []), [])` is identical to today's
  `assembleRegionShaderSource(SUBJ, BG, [])`, and likewise when only a RESERVED param
  (`colorA`) is present. A spec with no params must not re-render differently, and must not pay.
- Sorted slot assignment (`u_blur`→`uParam0`, `u_rim`→`uParam1`) and one shared alias set across
  per-object bodies.
- Schema: params/keyframes accepted with `ease`; `triggers` rejected; >4 numeric params rejected;
  the four reserved names not counted against the cap.
- Determinism: two seeks to the same frame index are byte-identical (`meanDiff === 0`).

Suite: **573 passed, 3 skipped, 0 failed**. `npm run build` clean. `npx tsc --noEmit` clean.

## Found wrong in existing code

1. **`regionShader` was not `.strict()`.** Every other segment object in `schema.ts` is. Unknown keys
   were silently stripped, so a typo (`subjet`, or `triggers` in this phase) parsed fine and rendered
   a beat with a missing body and no diagnostic. Now strict. This is a behaviour change for any spec
   that carried a stray key — none exist in the repo, and the whole suite is green.

2. **`RegionShader` never uploaded `uColorA`/`uColorB`/`uColorC`/`uIntensity`/`uPulse`/`iMouse`,**
   though all six are declared in the region header (it is built from the same `UNIFORM_HEADER`
   backgrounds use). They read 0. Pre-existing region `.frag`s referencing `uColorA` were silently
   rendering black, and once `params` existed, `params: { colorA: "#ff0000" }` would have hit the
   same trap — `colorA` is RESERVED so it never packs into a `uParam` slot. Rather than special-case
   it, `drawFrame` now calls `resolveUniforms` (which already computed all of them) and uploads the
   full set, exactly as `ShaderBackground` does.

3. **`resolveUniforms` had no callers outside its own module** other than `ShaderBackground`, and
   `RegionShader` had hand-rolled a partial subset of the same uniform upload. Now shared.

4. **Docs drift:** `docs/segmentation.md`'s TL;DR still said "spec app beat" — `app` was renamed to
   `video`. Fixed in passing.

5. **Tooling gotcha (no code impact):** `ugrep` 7.5.0 silently skips
   `src/render/native/page/ShaderBackground.tsx` as a binary file. `grep -n "resolveUniforms"` on it
   returns nothing and exits 1 even though the string is on line 10; `grep -an` finds it. This cost
   real time and would mislead anyone auditing that file. Use `grep -a` on it.

## Unresolved / deliberately deferred

- **`EXTRA_PARAM_SLOTS` is 4 for a whole beat**, however many bodies it has. A 4-mask beat wanting
  one knob each is exactly at the ceiling with nothing left for the background. Raising it means
  widening `UNIFORM_HEADER`, which backgrounds share, so it is a cross-cutting change and was out of
  scope. The build error makes hitting the wall obvious rather than mysterious, which is the part
  that mattered now.
- **`extraParamNames` still truncates silently for backgrounds.** Only `regionShader` errors. Making
  the shared helper strict would change background behaviour, which this phase does not own — but it
  is the real root cause and worth a follow-up.
- **`iTime`/`iTimeDelta` remain hardcoded to 30fps** in `RegionShader` (pre-existing, `ponytail:`-noted).
  Keyframe lookup now inherits that same assumption. Correct for every current kino comp; it would
  need `useVideoConfig().fps` if a non-30fps composition ever ships.
- **Cross-region sampling (roadmap phase 4)** is untouched and unblocked by this work.
