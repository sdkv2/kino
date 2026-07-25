# kino multi-subject cutout — design

Date: 2026-07-24
Branch: `feat/segmentation`
Status: proposed — not implemented. Written because the ask ("both dogs onto an empty background") doesn't fit today's `regionShader`, and a real fix belongs in the schema/shader assembler, not a one-off ffmpeg hack outside kino.

## Ask

Two dogs in `projects/dogtest/assets/video/dog_clip.mp4`, already segmented into two independent single-object masks (`masks/dogtest`, `masks/dogtest2`, one `kino segment` call each). Goal: one render where **both** dogs are cut out (kept as-is) and everything else is replaced by an empty background.

## Why this doesn't fit today

`regionShader` (schema.ts:135-143, shaderSource.ts:112-165) is built for exactly **one mask, one object channel, one binary split**:

```ts
regionShader: {
  mask: string;              // ONE mask asset dir
  subject?: string;          // shader for mask>0.5
  background?: string;       // shader for mask<=0.5
  object: number;            // 0..3 — ONE channel of that ONE mask
}
```

`assembleRegionShaderSource` compiles this straight into GLSL: `uChannel` is a single one-hot `vec4`, and the split is `m = dot(texture(uMask, uv), uChannel)`, `fragColor = mix(bg, subject, m)` — one sampler, one scalar, one cutoff. There is no way today to say "subject = object 0 OR object 1" and no way to say "subject = object 0 of mask A OR object 0 of mask B."

Two more gaps, found by reading the actual render path:

- **Our two dogs live in two separate mask files.** Each `kino segment` call produces its own single-object `mask.mp4` (grayscale, one channel used). Multi-object addressing only works when *one* `kino segment --objects 2` call tracks both subjects into one mask's R/G channels (`docs/segmentation.md` — "Multi-object addressing is video-only... occupy separate R/G/B channels"). We ran two independent calls with two different prompts, so there is no single mask file with both dogs as channels — combining them needs either a second `kino segment` pass or new plumbing to read two mask sources in one region shader.
- **Export is opaque-only.** `render/native/engine.ts:163` hardcodes `-pix_fmt yuv420p` for every render. "Empty background" can mean a solid color today (trivial — that's exactly what `regionShader.background` already does), but not a *transparent* cutout (alpha channel) — there's no alpha anywhere in the encode path.

## Proposed changes

Two independent, small features. Recommend doing (1) always; do (2) only if a transparent (not solid-color) background is actually wanted.

### 1. Multi-object / multi-mask union for `regionShader` (the actual unblock)

Schema (`src/spec/schema.ts`):

```ts
regionShader: z.object({
  mask: z.string().min(1).optional(),               // single-mask shorthand (today's field, still valid)
  masks: z.array(z.object({                         // NEW: multiple mask sources, each with its own object index
    mask: z.string().min(1),
    object: z.number().int().min(0).max(3).default(0),
  })).min(1).optional(),
  subject: z.string().min(1).optional(),
  background: z.string().min(1).optional(),
  object: z.number().int().min(0).max(3).default(0), // kept for the single-mask case
}).refine(v => v.mask || v.masks, ...)
  .refine(v => v.subject || v.background, ...)
```

`mask`+`object` (today's shape) stays valid — it's `masks: [{mask, object}]` with one entry. New case: `masks: [{mask: "masks/dogtest", object: 0}, {mask: "masks/dogtest2", object: 0}]`.

Shader assembly (`src/render/shaderSource.ts`): bind up to N mask samplers (reuse the `uTex0..3` pattern — e.g. `uMask0..uMask3` + `uChannel0..uChannel3`), and the region test becomes a union instead of a single dot:

```glsl
float m = 0.0;
m = max(m, dot(texture(uMask0, uv), uChannel0));
m = max(m, dot(texture(uMask1, uv), uChannel1));   // only emitted for bound slots
kino_fragColor = mix(b, s, m);
```

`props.ts` `RegionShaderProps` gains `masks: {maskSrc, maskKind, channel}[]` (plural) alongside (or replacing) the singular fields; `videoFrames.ts` extracts frames for every mask source the same way it does today for one.

Result: `subject: "backgrounds/region-red-tint.frag"` (or a passthrough) with `masks: [dog1, dog2]` and `background: "backgrounds/solid-black.frag"` keeps both dogs untouched and blacks out everything else — no ffmpeg step outside kino, no re-segmenting.

**Better long-term alternative, noted but not required:** re-run segmentation once with `kino segment dog_clip.mp4 --prompt "dog" --objects 2 --out dogtest-both`. The open-vocab detector already ranks-and-keeps top-N matches (`sam_runner.py::segment_one`), so a generic "dog" prompt with `--objects 2` should pick up both dogs into ONE mask's R/G channels natively, and today's `regionShader.object` (a single 0-3 index, no array needed) would... still only select ONE of them. So even the "do it right from the start" path needs the same union capability above (`object: number[]` on a single mask) — the multi-mask-source case is genuinely additional (for combining masks generated separately, like ours).

### 2. Transparent (not solid-color) cutout export — separate, larger, optional

Only needed if the deliverable must be an actual alpha-cutout asset (e.g. to composite into another NLE/timeline), not "dogs on black."

- New encode profile: `-c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0` (webm) instead of the current `libx264 -pix_fmt yuv420p` (mp4), gated behind an explicit flag (e.g. `kino build ... --alpha`) since most consumers (captions compositing, other beats) assume an opaque yuv420p frame.
- The region shader's background body would need to emit `fragColor.a = 0.0` instead of any color — a `backgrounds/transparent.frag` one-liner, no assembler change beyond not forcing `a=1`.
- Touches: `render/native/engine.ts` (encode args + output extension), `commands/build.ts` (new flag, output naming), docs.
- Scope/risk: real (a new codec path, a new file extension in `out/`, needs its own still/build verification) — worth its own follow-up, not bundled into (1).

## Recommendation

Implement (1) only, ship "both dogs on a solid empty background" (black, brand color, whatever `background.frag` renders) using kino's own regionShader/shader-texture machinery. Skip (2) unless the deliverable specifically needs true transparency rather than an empty-looking backdrop.
