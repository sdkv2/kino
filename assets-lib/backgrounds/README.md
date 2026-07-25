# Bundled faceless backgrounds

Bare ids for `background: "custom"` + `backgroundComponent`. Prefer these (or a
project-local component) over stock `mesh` when the brand should feel authored.

Resolution: bare id probes `assets-lib/backgrounds/<id>.{js,frag,glsl}` (first hit).
Project path: `assets/backgrounds/…` via `"backgroundComponent": "backgrounds/…"`.

## Canvas2D (`.js`)

File body is `draw(ctx, env)` — use `env.frame` / `env.params` / `env.pulse` only
(no `Date.now` / unseeded `Math.random`). Same keyframe/trigger surface as presets
(`kino backgrounds`).

| Id | Feel |
|---|---|
| `brand-wash` | Horizon wash + slow gold ribbon — brand stage, not generic SaaS mesh |

## WebGL shaders (`.frag` / `.glsl`)

Author only ShaderToy `mainImage(out vec4 fragColor, in vec2 fragCoord)`. Uniforms
+ helpers (`kinoBackdrop`, `aastep`, `u_<param>` aliases) come from kino — see
`skills/shader-backgrounds` and `docs/spec-reference.md` (Shader backgrounds).
`iTime = frame/fps` only (deterministic).

| Id | Feel |
|---|---|
| `aurora-flow` | Flowing three-color brand plasma — quick authored field |
| `liquid-orb` | Raymarched metaball — lit morphing isosurface + fog |
| `liquid-glass` | Refractive glass drop — chromatic dispersion over a structured env |
| `orb-badge` | Metaball with `uTex0` wrapped as a cylindrical DOM/image decal |
| `ui-hero` | Floating DOM card in 3D — sway, floor reflection, `reveal` dissolve |

```jsonc
{
  "background": "custom",
  "backgroundComponent": "aurora-flow",   // or "brand-wash" / "backgrounds/my.frag"
  "backgroundKeyframes": [
    { "at": 0, "params": { "intensity": 0.35 } },
    { "at": 3, "params": { "intensity": 0.7 }, "ease": "easeInOut" }
  ],
  "backgroundTriggers": [{ "at": 1.2, "action": "pulse" }]
}
```

Or set `backgroundComponent` on the brand (`brand.md` frontmatter) so every spec inherits it.

**Craft exemplars (project-local):** `projects/old-light/` (galaxy refraction),
`projects/vesper/` (ink bloom + `kino-glass`).
