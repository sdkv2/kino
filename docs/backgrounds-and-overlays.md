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
| `mesh` | ✅ | Flowing gradient mesh (**draft default — easy generic tell**). |
| `aurora` | ✅ | Drifting aurora ribbons. |
| `particles` | ✅ | Floating brand-coloured particles. |
| `grid` | ✅ | Perspective/▦ grid motion. |
| `solid` | — | Static night + glow (**loop-safe**; ignores frame drift). |
| `custom` | ✅ | Canvas2D draw fn **or** WebGL `.frag`/`.glsl` (`backgroundComponent`). |

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

**Prefer `custom` over stock `mesh`/`aurora` when the brand should feel authored** — custom
components use the same `backgroundKeyframes` / `backgroundTriggers` surface as presets.

1. Set `"background": "custom"`.
2. Point `backgroundComponent` — **spec overrides brand**:
   - Bare id → `assets-lib/backgrounds/<id>.{js,frag,glsl}` (first hit; start with `"brand-wash"` or `"aurora-flow"`)
   - Project path → `assets/backgrounds/my-wash.js` or `….frag`
   - Brand path → workspace-relative file from `brand.md` frontmatter
3. Animate with `colorA`/`B`/`C`, `intensity`, extras + `pulse` triggers.

```json
{
  "background": "custom",
  "backgroundComponent": "brand-wash",
  "backgroundKeyframes": [
    { "at": 0, "params": { "intensity": 0.35 } },
    { "at": 3, "params": { "intensity": 0.75 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 1.4, "action": "pulse" }]
}
```

**Canvas2D (`.js`)** — file body **is** `draw(ctx, env)`. Deterministic: `env.frame` /
`env.params` / `env.pulse` only — never `Date.now()` or unseeded `Math.random()`.

**WebGL (`.frag` / `.glsl`)** — author ShaderToy `mainImage` only. `iTime = frame/fps`;
optional `backgroundTextures` → `uTex0`..`uTex3`. Cover-fit + mirror helpers and `u_<param>`
aliases are injected at assemble time. Full contract: [Spec reference → Shader backgrounds](spec-reference.md#shader-backgrounds-frag--glsl).
Craft playbook: `skills/shader-backgrounds`. Library ids in `assets-lib/backgrounds/README.md`.

Run `kino backgrounds` for the picker + library ids.

For richer full-screen UI (typed terminals, pipelines), prefer [motion graphics](motion-graphics.md)
and paint a full-bleed `.bg` inside the graphic — that occludes the faceless layer entirely.
Pair `kino-glass` with a **structured** shader field (not a flat night), not frosted CSS blur.

| When | Use |
|---|---|
| Brand identity on faceless / caption cards | `custom` + `backgroundComponent` (`.js` or `.frag`) |
| Raymarch / plasma / photo refraction | `.frag` + `skills/shader-backgrounds` |
| Seamless loop / settle | `solid` (or custom that ignores frame drift at edges) + motion `.bg` |
| Real photo backdrop (static) | `image` + `facelessBackdrop` |
| Quick draft | `glow` / `mesh` / `aurora` — replace before ship if the frame is the brand |

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
