# Per-object regions (`masks[].subject`)

**Status:** design, 2026-07-24. Phase 2 of the four-phase roadmap in
`2026-07-24-mask-distance-design.md`.

## Problem

`regionShader` already accepts up to `MAX_REGION_MASKS = 4` mask sources, but every one of them
collapses into a single subject region. `assembleRegionShaderSource` emits:

```glsl
float m = 0.0;
m = max(m, dot(texture(uMask0, muv), uChannel0));
... (×4)
m = smoothstep(0.4, 0.6, m);
kino_fragColor = mix(b, s, m);
```

One `s`. So four tracked objects can only ever share one treatment. "Both dogs cut onto one
background" works; "the dog in mercury, the ball in glass" does not. The masks are already
bound, already animated, already per-object addressable — the only thing missing is a second
subject body and a rule for what happens where two masks overlap.

## Surface

One optional field, on the entry it belongs to:

```jsonc
"regionShader": {
  "masks": [
    { "mask": "masks/dog",  "object": 0, "subject": "backgrounds/mercury.frag" },
    { "mask": "masks/ball", "object": 0, "subject": "backgrounds/glass.frag" },
    { "mask": "masks/hand", "object": 0 }                       // ← falls back to the top-level subject
  ],
  "subject": "backgrounds/tint.frag",     // fallback for entries without their own
  "background": "backgrounds/plasma.frag"
}
```

Rejected alternatives:

- **A parallel `subjects: []` array.** Index-aligned arrays make overlap order illegible and
  desynchronise the moment someone edits one of them.
- **Reusing `object` as a shader selector.** `object` already means "which channel of this
  mask's manifest", and overloading it would break multi-object masks.

Backward compatibility is total: `mask`+`object`, and `masks[]` with a top-level `subject`,
both keep parsing and both keep generating **byte-identical GLSL** (see Cost).

## Overlap rule: painter's order

Two masks can cover the same pixel. The rule is **later entries paint over earlier ones** —
`masks[1]` wins over `masks[0]`, the way a stack of layers reads top-down when written
top-down, and the way `Array.prototype` order reads everywhere else in a spec.

The entry point becomes a composite instead of a single mix:

```glsl
vec4 c;  regionBg(c, gl_FragCoord.xy);
c = mix(c, s0, smoothstep(0.4, 0.6, dot(texture(uMask0, muv), uChannel0)));
c = mix(c, s1, smoothstep(0.4, 0.6, dot(texture(uMask1, muv), uChannel1)));
kino_fragColor = c;
```

Alternatives considered: "first entry wins" (reads backwards against the array), "highest
coverage wins" (non-deterministic-looking on antialiased edges, and undefined on a tie),
"error on overlap" (masks from two independent `kino segment` runs overlap constantly —
this would reject the main use case).

Note the per-mask `smoothstep` is applied *per composite step*, not once to a `max()`. In the
1px antialiased band where two masks both partially cover a pixel the result therefore differs
slightly from the union path's single `mix` — this is why the union path is kept verbatim
rather than expressed as a one-entry composite.

## `uMaskSelf` / `uChannelSelf`

A per-entry body needs to know **which** mask it is shading, or `kinoMaskDist` cannot give it
a rim on its own subject. Hardcoding `uMask1` works but binds the `.frag` to an array
position. So each per-entry body is wrapped:

```glsl
#define uMaskSelf uMask1
#define uChannelSelf uChannel1
#define mainImage regionSubject1
<the body>
#undef mainImage
#undef uChannelSelf
#undef uMaskSelf
```

Defined **only inside a per-entry subject body**. The top-level `subject` spans every entry
that falls back to it and the `background` body spans the whole frame, so neither has a single
"self"; using `uMaskSelf` there is a compile error naming an undeclared identifier, which the
fatal path reports with line-numbered source.

This corrects the `min()` guidance in `docs/segmentation.md`. That guidance was written for a
union subject and stays right *there* — for a per-entry body, the edge that matters is its own
mask's, so the call is `kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, r)` and there is
nothing to `min()`.

## No dedupe

Each per-entry `subject` emits its own GLSL function, even when two entries name the same
`.frag`. The bodies land in one translation unit (only `mainImage` is renamed), so the same
file twice is a duplicate definition for anything it declares at file scope — the identical,
already-documented hazard as declaring `float lum(vec3)` in both `subject` and `background`.
The answer is the same: if two entries want the same treatment, that is what the top-level
`subject` fallback is for, and it emits exactly one function.

Deduping by body text was considered and rejected: a deduped function serves two masks, so it
cannot carry `uMaskSelf`, which is precisely the thing a second subject body wants.

## Cost

Both region bodies already run for every pixel (`ponytail:` note in the assembler). With N
distinct subject bodies it becomes N+1 bodies per pixel, on a renderer that defaults to
SwiftShader (software).

Nobody pays for a feature they did not use:

- **No entry carries a `subject`** → the assembler emits the union path **byte-for-byte
  unchanged**. Same two bodies, same `max()` reduce, same single mix. This is asserted by
  string equality in `tests/segment-regionshader-src.test.ts`.
- **Every entry carries its own `subject`** → the shared fallback body is not emitted or
  called at all. Two masks with two bodies is 3 bodies per pixel, not 4.

So the emitted body count is `(number of entries with their own subject) + (1 if any entry
falls back) + 1 background`. Measured wall-clock numbers go in `docs/segmentation.md`.

## Out of scope

- `params`/`keyframes` on region shaders (Phase 3).
- Cross-region sampling (Phase 4).
- Raising `MAX_REGION_MASKS`.
- Per-entry `background` (there is one background by definition).

## Testing

Following Phase 1's bar: string assertions are necessary but not sufficient.

1. **Render-level, real GLSL, real pixels.** Two deliberately overlapping image masks, a red
   body on entry 0, a green body on entry 1, blue background. Four crops: mask-0-only, the
   overlap, mask-1-only, outside. The overlap crop is what proves painter's order — reversing
   the rule turns it red.
2. **`uMaskSelf` rides the same render.** Entry 1's blue channel is
   `1.0 - step(-40.0, kinoMaskDist(uMaskSelf, uChannelSelf, f, 48.0))` — 1 deep inside *its
   own* mask. If `uMaskSelf` resolved to `uMask0`, the mask-1-only crop (which is 100px clear
   of mask 0) reads blue 0 and the assertion fails.
3. **Byte-identical fallback.** `assembleRegionShaderSource(s, b, [], [])` must `toBe`
   `assembleRegionShaderSource(s, b, [])`.
4. Schema round-trips, and the existing suite unchanged.
