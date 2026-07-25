# Region shader params + keyframes — design

Phase 3 of the region-shader roadmap (`2026-07-24-mask-distance-design.md` § Roadmap).

## Problem

A `regionShader` body is a static program. An author who wants a rim to thicken, a film to shift
hue, or contour lines to drift has to hardcode the constant and re-render to change it. `background`
already solved this: `backgroundKeyframes` tween named numeric params and the shader reads them as
`u_<name>`. Phase 3 gives `regionShader` the same surface — no new concept, just the missing wiring.

## What already exists

The GLSL side is done and untouched by this phase:

- `assembleRegionShaderSource(subject, background, extraNames, maskBodies)` already emits
  `#define u_<name> uParamI` aliases from `extraNames`. Every caller passed `[]`.
- `extraParamNames(base, keyframes)` gives the sorted, RESERVED-filtered, slot-capped name list.
- `resolveUniforms(params, ctx, extraNames)` already turns resolved params into concrete values.
- `uParam0..3` and the colour/intensity uniforms are already declared in the region header
  (it is built from the same `UNIFORM_HEADER` backgrounds use).

The gap is entirely plumbing: no spec field, no resolve in `build.ts`, and `RegionShader.tsx` never
uploads `uParam*` (it uploads only `iResolution`/`iTime`/`iFrame`/`iTimeDelta`/`uChannel*`).

## Decisions

### 1. Schema — one shared param set

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

`params` and `keyframes` sit on `regionShader` itself, NOT on each `masks[]` entry. One bank is
shared by the subject body, the background body, and every per-entry body.

Rejected: per-entry param sets. There is exactly one uniform bank (`uParam0..3`) in the one program
all bodies share. Per-entry sets would need per-entry banks — 4 masks × 4 slots = 16 uniforms and a
16-way alias scheme — and would blow past the ceiling on the first two-mask spec. The shared bank
also matches how bodies already share `uColorA`/`iTime`.

`keyframes` reuses the existing `BgKeyframe` shape (`{at, params, ease?}`) verbatim.

### 2. Timing is beat-relative

`at` is seconds from THIS beat's start, like `zoomKeyframes` and `captionKeyframes` — not absolute
seconds like `backgroundKeyframes`.

This is not just an idiom choice, it is what the component already does. `RegionShader` is mounted
inside `<Sequence from={f(s.startSec)}>` (`KinoVideo.tsx`), and `Sequence` rebases the clock
(`runtime.tsx`: `<FrameCtx.Provider value={frame - from}>`). So `useCurrentFrame()` inside
`RegionShader` is ALREADY beat-relative, and the existing `iTime = frame / 30` is already a
beat-relative clock. Beat-relative keyframes are therefore literally `paramsAt(params, keyframes,
frame / fps)` with no new plumbing, and they agree with `iTime`.

Absolute timing would be the expensive option: it would need `startSec` threaded into the component
as a new prop, and it would leave `iTime` and `u_<name>` on two different clocks in the same shader
— a guaranteed authoring trap. `backgroundKeyframes` are absolute only because a background spans
the whole video; a `regionShader` belongs to one beat. Beat-relative also means a track keeps riding
real VO timing when a beat shifts, which is the reason `zoomKeyframes` exist.

### 3. Triggers / `uPulse` — not this phase (YAGNI)

No `regionShader.triggers`. Nothing in the roadmap or in any shipped `.frag` needs a one-shot yet,
and a trigger surface is a second timing concept to document and test for zero current callers.
`uPulse` is declared in the region header and stays at its GL default of 0, so a body referencing it
compiles and reads a constant 0. When a real one-shot appears, `pulseAt(triggers, frame/fps)` drops
into the exact call site this phase adds, next to `paramsAt`.

### 4. Reserved params are uploaded too

`RegionShader` currently uploads none of `uColorA`/`uColorB`/`uColorC`/`uIntensity`/`uPulse`/
`iMouse`, so they all read 0. Once `params` exists, an author writing
`params: { colorA: "#ff0000" }` would get silent black — `colorA` is RESERVED so it never packs into
a `uParam` slot, and nothing uploads `uColorA`. Rather than special-case it, this phase calls
`resolveUniforms` (which already computes all of them) and uploads the full set, exactly as
`ShaderBackground` does. Five extra uniform calls; the surface then genuinely matches backgrounds.

### 5. The 4-slot ceiling

`EXTRA_PARAM_SLOTS` stays 4. Because the bank is shared, the cap is on the UNION of numeric
non-reserved names across `params` and every keyframe — not per body. Four named numeric params for
the whole beat, plus the four reserved colour/intensity params on top.

`extraParamNames` silently `slice`s past 4, which for a background means a fifth param quietly does
nothing. That is a bad failure mode on a brand-new surface, so `resolveRegionShader` throws at build
time when the union exceeds `EXTRA_PARAM_SLOTS`, naming the params. `extraParamNames` itself is
unchanged — backgrounds keep their current behaviour; this phase does not get to change theirs.

### 6. Backward compatibility

A `regionShader` with no `params`/`keyframes` resolves to `extraNames = []`, so
`assembleRegionShaderSource` is called exactly as before and emits a byte-identical program.
Asserted with `toBe` on the assembled source, not by eye.

`extraNames` must also join `RegionShader`'s `glKey`, or a page reused for a second spec that
differs only in its param NAMES would keep the first spec's compiled aliases — the same trap
per-object bodies hit in `render-region-reuse.test.ts`.

## Testing

A string assertion that a keyframe parsed proves nothing. The load-bearing test is a real render:

- One video beat starting at **2s** (not 0 — so beat-relative and absolute timing give different
  answers and the test can tell them apart).
- `keyframes` tween `lift` 0 → 1 over beat-relative 0 → 1s.
- Subject body outputs `vec4(u_lift)`, background body outputs constant blue (the control).
- Render composition frames 60 / 75 / 90 = beat t 0 / 0.5 / 1.0.
- Assert the subject crop reads ~0 / ~0.5 / ~1.0 and the background crop never moves.

The midpoint is what proves it TWEENS rather than steps, and the 2s beat offset is what proves the
clock is beat-relative: under absolute timing, beat t=0 is absolute t=2, past the last keyframe, so
the first frame would read 1.0 instead of 0.

Each assertion is verified by deliberately breaking what it guards and recording the numbers.

## Constraints held

GLSL ES 3.00; determinism (motion only from `iTime` and keyframed params — `paramsAt` is a pure
function of the frame index). `kinoMaskDist`'s signature is untouched and it gains no new call sites.
`MAX_REGION_MASKS = 4` and `EXTRA_PARAM_SLOTS = 4` unchanged.
