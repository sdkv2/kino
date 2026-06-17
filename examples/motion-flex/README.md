# motion-flex — example motion graphics

A showcase of kino's **motion graphics** (Tier 1): agent-authored HTML/CSS files driven entirely by
kino-set CSS variables, composited deterministically into the video. Three beats, three patterns:

| File | Flexes |
|---|---|
| [`hero.html`](hero.html) | Kinetic title — staggered line reveals, gradient-clipped text with a `--t` sheen, glow breathing off `sin(--t)`, exit fade on `--progress`. |
| [`stat.html`](stat.html) | A **pure-CSS count-up** (`counter-reset: n round(down, var(--pct), 1)`), a bar filling to `--pct%`, and a keyword line **auto-staggered with `sibling-index()`**. |
| [`orbit.html`](orbit.html) | Generative outro — four dots orbiting continuously off `--t` at different rates, pulsing rings, gradient wordmark. |

Everything is a pure function of the frame — no `@keyframes`, no `transition`, no JS — so it passes
the determinism lint and renders identically every time.

## Render it

```bash
npx tsx examples/motion-flex/render-flex.ts            # six verification stills → out/
FLEX_VIDEO=1 npx tsx examples/motion-flex/render-flex.ts   # the 9:16 mp4 → out/motion-flex-9x16.mp4
```

[`render-flex.ts`](render-flex.ts) builds the `KinoProps` directly and calls the real
`renderStills` / `renderVideo` path — the same one `kino build` uses (minus VO/avatar, which motion
graphics don't need). `out/` is gitignored.

## Patterns worth copying

- **Stagger** so things don't all land at once: `sibling-index()` for a list (one rule, no params),
  or give each element its own slice of `--progress`. See `stat.html`.
- **Keep entrances calm**: drive them from spec keyframe params with `ease:"easeInOut"` (vs the
  bouncier `spring`/`overshoot`), and let them last ~1s.
- **Add continuous life** off `--t` (sheen, breathing, orbits) so a beat isn't frozen after it enters.
- **Crossfade beats** by overlapping their `startSec`/`endSec` and exit-fading on `--progress`.

Run `kino motion` for the full CSS-variable contract and the stagger recipes.
