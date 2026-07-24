# Per-object regions — build report

**Phase 2** of the roadmap in `2026-07-24-mask-distance-design.md`.
Branch `feat/per-object-regions`, off `feat/segmentation` @ `d974c85`.
Design: `2026-07-24-per-object-regions-design.md`. Plan: `../plans/2026-07-24-per-object-regions.md`.

## The schema I chose

An optional `subject` on each `masks[]` entry, next to the mask it belongs to:

```jsonc
"regionShader": {
  "masks": [
    { "mask": "masks/dog",  "object": 0, "subject": "backgrounds/mercury.frag" },
    { "mask": "masks/ball", "object": 0, "subject": "backgrounds/glass.frag" },
    { "mask": "masks/hand", "object": 0 }                       // → top-level subject
  ],
  "subject": "backgrounds/tint.frag",
  "background": "backgrounds/plasma.frag"
}
```

The top-level `subject` stays exactly what it was and becomes the fallback for entries without
their own. A parallel `subjects: []` array was rejected — index-aligned arrays make overlap order
illegible and desynchronise the moment someone edits one of them.

The only other schema change: the "needs a body" refine now counts per-entry subjects
(`v.subject || v.background || v.masks?.some((m) => m.subject)`), so a spec whose every mask
shades itself is legal without a top-level body.

Threaded through: `schema.ts` → `build.ts` `resolveRegionShader` (reads the `.frag` per entry) →
`RegionShaderMask.subjectCode` → a fourth argument on `assembleRegionShaderSource`. The runtime
also folds the per-mask bodies into `glKey` in `RegionShader.tsx`, without which two specs that
differ only in a `masks[].subject` would reuse the first one's compiled program — the exact bug
`tests/render-region-reuse.test.ts` was written for.

## The overlap rule: painter's order

**Later entries paint over earlier ones.** `masks[1]` wins over `masks[0]`. The entry point starts
from the background colour and `mix()`es each mask's body over it in array order.

Rejected: "first entry wins" (reads backwards against the array), "highest coverage wins"
(undefined on a tie, and looks non-deterministic along antialiased edges), "error on overlap"
(masks from two independent `kino segment` runs overlap constantly — this rejects the main use
case). Painter's order is the one that reads the way the array reads, and reordering the array is
the obvious way to change who is in front.

Tested with two deliberately overlapping rectangle masks — see below.

## `uMaskSelf` / `uChannelSelf`

A per-entry body is wrapped in `#define uMaskSelf uMaskN` / `#define uChannelSelf uChannelN` (and
`#undef`'d after), so a rim/outline `.frag` can call
`kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, r)` and get **its own** subject's edge without
hardcoding an array position. Without this, per-object regions and Phase 1 do not compose: the
motivating effect (two subjects, each with its own rim) would need each `.frag` bound to a slot.

They are deliberately **not** defined in the shared `subject` or the `background` body — those span
several masks / the whole frame, so there is no single "self", and using the alias there is a loud
compile error rather than a silently wrong edge.

This corrects `docs/segmentation.md`, which told authors to `min()` per-mask distances. That advice
was written for a union subject and is still right *there*; a per-entry body has one edge and
nothing to `min()`. Both cases are now spelled out.

**No dedupe.** Two entries naming the same `.frag` emit two functions, so anything the file declares
at file scope is a duplicate definition — the identical, already-documented hazard as declaring
`float lum(vec3)` in both `subject` and `background`. Deduping by body text was rejected because a
deduped function serves two masks and therefore cannot carry `uMaskSelf`. The answer for "same
treatment on two masks" is the top-level `subject` fallback, which compiles and runs once.

## Cost

Measured on an Apple M4, 1080×1920, 12 stills per configuration, default SwiftShader (software)
renderer, warm run after a discarded warm-up:

| bodies/px | ≈120 ALU ops/px body | ≈750 ALU ops/px body |
| --- | --- | --- |
| 2 (1 mask, union) | 0.37 s/frame | 0.71 s/frame |
| 5 (4 masks, one body each) | 0.48 s/frame (**1.28×**) | 1.30 s/frame (**1.85×**) |

Marginal cost of one extra body: ~0.04 s/frame light, ~0.20 s/frame heavy. Solving for fixed
overhead gives ~0.30 s/frame that four bodies do **not** multiply (page work, capture, PNG encode,
finishing pass) — which is why 5× the fragment work is under 2× end-to-end. 4 masks on the *union*
path cost 1.04× of 1 mask, i.e. extra masks are nearly free until they carry their own body.

**Nobody pays for what they don't use.** With no per-entry `subject` anywhere, the assembler emits
the pre-Phase-2 union program **byte-for-byte** — this is asserted by string equality, not by
inspection (`assembleRegionShaderSource(S, B, [], []) toBe assembleRegionShaderSource(S, B, [])`).
And when every entry has its own body, the shared fallback is neither emitted nor called: 2 masks
with 2 bodies is 3 bodies/px, not 4.

## What I tested, and how I proved it bites

`tests/render-region-perobject.test.ts` — one real render through `renderStills`, two overlapping
image masks (x 100–600 and x 400–900), a red body on entry 0, a green body on entry 1 whose **blue
channel** is `1.0 - step(-40.0, kinoMaskDist(uMaskSelf, uChannelSelf, f, 48.0))`, and a blue
background body. Four crops read the four regions the two masks carve out. Measured means:
`only0=1,0,0  overlap=0,1,1  only1=0,1,1  outside=0,0,1`, plus a byte-identical second seek to the
same frame index.

Three deliberate breaks, each reverted:

| break | measured | result |
| --- | --- | --- |
| reverse the composite order | `overlap=1,0,0` | FAIL — the overlap crop turns red |
| `uMaskSelf` → always `uMask0` | `only1=0,1,0` | FAIL — the self-distance probe loses its blue |
| every mask composites `s0` | `only1=1,0,0`, `overlap=1,0,0` | FAIL — the pre-Phase-2 one-subject collapse |

Two string-level breaks in `tests/segment-regionshader-src.test.ts` likewise confirmed failing
(reversed composite order; `uMaskSelf` pinned to slot 0).

Also added: 5 assembler cases (byte-identical union fallback, per-mask functions in array order,
`uMaskSelf` scoping and `#undef` count, shared fallback emitted once and only when needed, slots
past `MAX_REGION_MASKS` dropped) and 3 schema cases (per-entry subject parses; per-entry subjects
alone satisfy the refine; no body anywhere still throws).

Full suite: **545 passed, 3 skipped, 0 failed** (`npx vitest run`). `npm run build` clean.
`examples/segmentation/region-smoke.json` parses unchanged and resolves to the union path, verified
byte-identical against the old assembler output.

## Could not resolve / left alone

- **The AA band is not identical between the two paths.** The union tail applies one
  `smoothstep(0.4, 0.6, max(...))`; the per-object tail applies the smoothstep per composite step.
  Where two masks *both* partially cover the same pixel — a ~1px seam — the blend differs slightly.
  This is exactly why the union tail is kept verbatim instead of being expressed as a one-entry
  composite. Not visible at any realistic scale, but it is a real difference and it is documented.
- **`MAX_REGION_MASKS` stays 4.** Raising it is a bigger change (texture units, `/vframes` jobs) and
  was out of scope.
- **No per-entry `background`.** There is one background by definition.

## Found wrong in existing code

- `docs/segmentation.md`'s "How region shaders assemble" paragraph said the mask binds to `uMask`
  (singular). It has been `uMask0..3` since the `masks[]` union shipped. Corrected.
- The same paragraph's `fragColor = mix(bgColor, subjectColor, dot(texture(uMask, uv), uChannel))`
  omitted the `smoothstep(0.4, 0.6, m)` that is actually emitted. Corrected.
- `resolveRegionShader` in `build.ts` declared `loadBody` *after* the `masks` map that now needs it.
  Hoisted (no behaviour change).
- The `kinoMaskDist` `min()` guidance was unqualified; it only ever applied to a body spanning a
  union. Now scoped, with the per-entry alternative next to it.
