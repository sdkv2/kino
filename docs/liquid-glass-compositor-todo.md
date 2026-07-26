# kino-glass refraction under the GL compositor (follow-up)

**Status today:** `.kino-glass` refraction is **broken** on the compositor render path. A glass card
renders as a flat film-over-black rectangle, and because the mirror canvas is composited *over* the
element, the card's own children (title/subtitle) are hidden behind it. Geometry, radius and
placement are correct — only the refracted backdrop is missing.

This is **not** a regression from the compositor orientation/scale fixes. It reproduces identically
on `2ac8e71` (the commit before them).

## Root cause: the backdrop texture crosses a WebGL context boundary

The compositor publishes its backdrop as a GPU texture:

- `renderer.ts:383` — `registerBackdropTexture(dest.tex, this.width, this.height)`, where `dest.tex`
  belongs to the **compositor's** `WebGL2RenderingContext`.

But each glass element renders its mirror in a **context of its own**:

- `liquidGlass.ts:271` — `makeState()` does `document.createElement("canvas").getContext("webgl2", …)`
  per element, with its own program and textures.
- `liquidGlass.ts:485` — that per-element context then does
  `gl.bindTexture(gl.TEXTURE_2D, backdropTexture.tex)`.

WebGL objects are **not shareable between contexts**. The bind is invalid, `uBg` samples black, and
the `uIsFullBg > 0.5` branch (`liquidGlass.ts:155`) returns black for every tap — hence a uniform
card tinted only by `--glass-film`.

The *other* backdrop path still works, because it moves pixels through a canvas rather than a
texture handle: `registerBackdrop(source, w, h)` (`liquidGlass.ts:63`) → `drawImage` into the
per-element stage canvas → `texImage2D`. **Nothing in the compositor ever calls it**, so the
working path is dead code on this render path.

## Why the test didn't catch it

`tests/liquid-glass-showcase.test.ts > kino-glass refracts a busy field (stripe control)` samples
`400x400+340+760` and asserts stddev > 0.02. It passed only by accident: markup rasters used to lay
out at supersampled size, so the 840×420 card rendered at half size and the sample window caught
background stripes *outside* the card. Once rasters render at their authored size the window sits
fully inside the flat card and the assertion correctly fails.

**Do not "fix" this by moving the crop window** — that re-hides the real bug. The assertion is right;
the renderer is wrong.

## Two ways out (pick one — this is a design call)

1. **Render the mirrors in the compositor's context.** Architecturally correct and keeps everything
   on the GPU. `registerBackdropTexture` would pass the owning `gl` alongside the texture, and
   `applyLiquidGlass` (`liquidGlass.ts:392`) would render each lens into a compositor-owned target
   instead of a private canvas. The wrinkle: `rasterGlassMirrors`
   (`providers/motion.ts:38`) composites mirrors into a **2D canvas** that is then uploaded as the
   motion layer's texture, so the mirror has to come back as a canvas — or the glass layer has to
   stop travelling through the motion raster at all and become its own compositor layer.
2. **Feed the canvas path instead.** Have the compositor `readPixels` its composite into a 2D canvas
   and call `registerBackdrop(…)`. Much smaller change and reuses a code path that already works,
   but it's a full-frame GPU→CPU readback per glass layer per frame at supersampled size — measure
   before committing to it.

## Repro / verification

```bash
npx vitest run tests/liquid-glass-showcase.test.ts
```

Visual check (the card should show refracted, displaced stripes at its rim and its own title text,
not a flat dark slab):

```bash
node dist/cli.js still projects/compositor-demo/specs/showcase.json --segment 1
```

Done when the stripe-control assertion passes **without** its crop window being changed, and the
`compositor-demo` showcase card visibly refracts.
