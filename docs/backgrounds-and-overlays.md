# Backgrounds & overlays

For faceless beats (no avatar), kino renders a deterministic, brand-coloured **background**. On any beat it can also lay out **overlay elements** — the logo mark, captions, and kickers — all tweenable on one shared keyframe layer. This page documents both. For where these fields live in the spec, see the [Spec reference](spec-reference.md); for fully custom animated beats, see [Motion graphics](motion-graphics.md).

- [Faceless backgrounds](#faceless-backgrounds)
- [Animating a background](#animating-a-background)
- [Custom backgrounds](#custom-backgrounds)
- [Overlay elements](#overlay-elements)

## Faceless backgrounds

Select the engine with `background` (spec) / `--background` (CLI) / `brand.background`. All presets are frame-deterministic (Canvas2D) and auto-coloured from the brand palette (override with `brand.backgroundColors`). Run `kino backgrounds` for the live contract.

| Preset | Animated | Description |
|---|---|---|
| `glow` | — | Soft CSS radial glow (calm, cheap). |
| `image` | — | A static backdrop image (`brand.facelessBackdrop`). |
| `mesh` | ✅ | Flowing gradient mesh. |
| `aurora` | ✅ | Drifting aurora ribbons. |
| `particles` | ✅ | Floating brand-coloured particles. |
| `grid` | ✅ | Perspective/▦ grid motion. |
| `custom` | ✅ | Your own Canvas2D draw fn (`brand.backgroundComponent`). |

The four animated presets (`mesh`, `aurora`, `particles`, `grid`) share the same controllable params and one action:

| Param | Type | Default | Range | Meaning |
|---|---|---|---|---|
| `colorA` | color | `#80e2b4` | — | Primary brand colour. |
| `colorB` | color | `#0c8d64` | — | Secondary colour. |
| `colorC` | color | `#d99a20` | — | Accent colour. |
| `intensity` | number | `0.5` | 0..1 | Motion / brightness strength. |

| Action | Effect |
|---|---|
| `pulse` | One-shot energy swell (surfaces to the preset as a decaying envelope). |

## Animating a background

Tween params over time with `backgroundKeyframes` and fire one-shot `backgroundTriggers`. Times are absolute on the main timeline — get them from `kino inspect` (per-word VO start/end) so motion lands on the words.

```json
{
  "background": "aurora",
  "backgroundIntensity": 0.6,
  "backgroundKeyframes": [
    { "at": 0,   "params": { "intensity": 0.3, "colorC": "#d99a20" } },
    { "at": 2.5, "params": { "intensity": 0.8 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 2.5, "action": "pulse" }]
}
```

`ease` ∈ `linear | easeInOut | overshoot | spring` (see [Keyframes & triggers](spec-reference.md#keyframes--triggers)).

## Custom backgrounds

Set `background: "custom"` and point `brand.backgroundComponent` at a Canvas2D draw function. It is called per frame and receives an `env` carrying the resolved params (`env.params`, e.g. your `colorA`/`intensity`) and the live trigger envelope (`env.pulse`), so it animates off the same `backgroundKeyframes`/`backgroundTriggers` as the built-in presets. Like every kino visual it must be **deterministic** — derive all motion from the frame/params/pulse it's given, never from the wall clock or randomness. (For richer agent-authored visuals, prefer [motion graphics](motion-graphics.md), which run in a sandboxed Shadow DOM with a full CSS-variable contract.)

## Overlay elements

Run `kino elements` for the live contract. All overlays tween on the shared keyframe model (`{ at, params, ease? }`), with `x/y` as a **percent-of-frame offset** and `scale`/`opacity` as multipliers.

### Logo

Shown on faceless talking beats. Set `logoSize`/`logoPosition` (spec or brand), and tween with `logoKeyframes` (`params: { x, y, scale, opacity }`).

| Size | px |
|---|---|
| `small` | 100 |
| `medium` | 150 (default) |
| `big` | 220 |

…or a custom number.

| Position | x, y (% of frame) |
|---|---|
| `top` | 50, 8 (default) |
| `bottom` | 50, 88 |
| `left` | 12, 50 |
| `right` | 88, 50 |
| `center` | 50, 50 |

…or a custom `{ x, y }`. The element is anchored at its centre on `(x, y)`.

```json
{
  "logoSize": "small",
  "logoPosition": "top",
  "logoKeyframes": [
    { "at": 0,   "params": { "opacity": 0, "y": -4 } },
    { "at": 0.4, "params": { "opacity": 1, "y": 0 }, "ease": "easeInOut" }
  ]
}
```

### Captions

Tween per segment with `captionKeyframes` (`params: { x, y, scale, opacity }`, x/y as % offset). For legibility over light app screenshots, enable the **backplate** on the brand: `captionStyle.background { color?, opacity?, appOnly? }` — a translucent rounded panel behind the lower-third caption. `appOnly` (default `true`) scopes it to app cut-ins; `opacity` defaults to `0.82`; `color` defaults to brand `night`.

### Kickers

The small label on `app` beats (`kicker: { text, color }`, color ∈ `mint|green|gold`) tweens via `kickerKeyframes` (`params: { x, y, scale, opacity }`).

See also: [Spec reference](spec-reference.md) · [CLI reference](cli-reference.md) · [Motion graphics](motion-graphics.md).
