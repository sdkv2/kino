# Bundled faceless backgrounds

Bare ids for `background: "custom"` + `backgroundComponent`. Prefer these (or a project-local
draw fn) over stock `mesh` when the brand should feel authored.

| Id | Feel |
|---|---|
| `brand-wash` | Horizon wash + slow gold ribbon — brand stage, not generic SaaS mesh |

```jsonc
{
  "background": "custom",
  "backgroundComponent": "brand-wash",   // bare id → this folder
  "backgroundKeyframes": [
    { "at": 0, "params": { "intensity": 0.35 } },
    { "at": 3, "params": { "intensity": 0.7 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 1.2, "action": "pulse" }]
}
```

Or set `backgroundComponent` on the brand (`brand.md` frontmatter) so every spec inherits it.

**Contract:** file body is `draw(ctx, env)` — use `env.frame` / `env.params` / `env.pulse` only
(no `Date.now` / unseeded `Math.random`). Same keyframe/trigger surface as presets (`kino backgrounds`).

Project-local: put `assets/backgrounds/my-wash.js` and set `"backgroundComponent": "backgrounds/my-wash.js"`.
