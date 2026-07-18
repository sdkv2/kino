# Stylised Text — Design

**Date:** 2026-07-18
**Status:** Approved

## Goal

Give the driving agent more expressive text: named caption style presets, named text
animation presets, and simple standalone text overlays — without new freeform knobs.
Today every text surface (`Caption`, `WordCaption`, `HeroCaption`) has one hardcoded
look: 900-weight brand font, white ink, black stroke, mint karaoke highlight.

## Non-goals

- Inline rich-text markup inside caption strings (per-word color/size markup). Not wanted.
- Freeform overlay positioning (arbitrary x/y, rotation, per-overlay fonts). The existing
  keyframe tracks and motion-graphic tiers already cover arbitrary needs.
- New fonts or palette slots. Presets draw from the resolved brand theme only.

## Spec surface (agent-authored)

Two new enum fields, layered exactly like `captionMode` (segment ?? spec ?? brand ?? default):

- `captionStyle`: `"stroke" | "highlight" | "gradient" | "minimal"` — default `"stroke"`
- `captionAnimation`: `"pop" | "rise" | "typewriter" | "wave" | "blur-in" | "none"` — default `"pop"`

Both accepted at spec top level and per segment. Brand frontmatter gains
`captionStyle.style` and `captionStyle.animation` alongside existing `fontSize` /
`strokeWidth` / `background`.

New optional per-segment `texts` array (all segment kinds — standalone overlays):

```json
{
  "text": "3× faster",
  "at": 1.2,
  "dur": 2.5,
  "position": "top",
  "size": "big",
  "style": "gradient",
  "animation": "blur-in"
}
```

- `text` (required), `at` seconds relative to segment start (required)
- `dur` seconds, default = to segment end
- `position`: `"top" | "center" | "bottom" | "left" | "right"` slot, default `"center"`
- `size`: `"small" | "medium" | "big"`, default `"medium"` (multipliers of `captionFontSize`)
- `style` / `animation`: default to the segment's resolved caption values

Defaults reproduce today's output pixel-for-pixel; existing specs and brands are untouched.

## Resolution (build time)

`build.ts` resolves per segment:

- `KinoSegment.captionStyle` / `captionAnimation` — the layered enums above.
- `KinoSegment.texts?: ResolvedText[]` — `{ text, fromSec, durSec, x, y, sizePx, style, animation }`
  with position slots mapped to (x, y) percentages and size names to px.

`Theme` is unchanged (colors/font already carry everything presets need).

## Render

New pure module `src/render/textStyles.ts` (compiled-land, importable by CLI and
Remotion code, like `captionLayout.ts`):

- `wordStyle(style, t, flags)` → per-word CSS (`color`, stroke, shadow, box), where
  `flags = { active, emph, highlight }`.
- `lineStyle(style, t)` → container CSS (e.g. boxed line; absorbs the current
  `plateStyle` backplate path).
- `animatePreset(anim, { frame, fps, index })` → `{ transform, opacity, filter }`
  for one word (or the whole line in phrase mode). Pure math on `spring`/`interpolate`
  values passed in by the component.

`Caption`, `WordCaption`, `HeroCaption` swap their hardcoded style objects for these
calls. `stroke` + `pop` must render identically to the current output (regression
gate).

New `TextOverlay` component renders `texts` entries as `Sequence`s. Stack slot in
`KinoVideo`: above motion-graphic overlays, below captions and disclosure.

## Look mapping

| style | words mode | phrase / hero mode |
|---|---|---|
| `stroke` | current look (default) | current look (default) |
| `highlight` | active word gets rounded mint box, night ink | whole line boxed (opaque brand plate) |
| `gradient` | mint→green background-clip fill; stroke dropped (background-clip conflict); drop-shadow for legibility | same |
| `minimal` | weight 700, no stroke, soft shadow | same |

## Animation mapping

| animation | behaviour |
|---|---|
| `pop` | current spring scale-in (default) |
| `rise` | current hero translateY cascade, now selectable on any surface |
| `typewriter` | staggered instant reveal, no motion |
| `wave` | pop entrance, then gentle per-word sine bob |
| `blur-in` | blur 12px→0 + fade |
| `none` | static |

Words mode: the preset shapes each word's *entrance*; reveal timing stays VO-driven
(word timings). Style and animation are orthogonal — any style × any animation ×
phrase/words/hero/overlay.

## Docs + tests

- `docs/spec-reference.md` updated in the same change (schema header mandates sync).
- Brand doc fields noted where brand frontmatter is documented.
- Vitest: resolution layering (segment/spec/brand/default) + pure `textStyles`
  functions (style CSS shapes, animation outputs at t=0 / settled).
- Visual verification via `kino still` / `kino frames`.

## Error handling

Zod enums reject unknown style/animation/position/size values at validate time with
the existing spec-error path. `texts` entries with `at` beyond segment duration render
zero frames (harmless), same as existing keyframe semantics — no extra validation.
