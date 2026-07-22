---
name: 3d-scenes
description: >
  Use when authoring, debugging, or shipping kino 3D beats (*.scene.js) —
  Blender backend (Eevee drafts / Cycles finals), api.* recording surface,
  presets (phone-orbit / depth-particles / wordmark-3d), quality tiers,
  draft/final CLI, timeline cache, and 3D craft gates. Not for Tier-1/2 HTML/JS
  motion or ordinary captions.
---

# 3D scenes in kino

Contract + `api.*` table: `docs/3d-scenes.md`. **Ground truth for the surface:**
`src/render/scene/recordApi.ts` (recorder) + `scripts/kino_render.py` (Blender
translator). This skill is the **workflow + craft brief** — when to reach for 3D,
how to iterate without burning Cycles time, and what “done” looks like on a sheet.

## When to Read this

- New `kind:"motion"` / `motionOverlay` with a `.scene.js` source (or bare preset id)
- “Make a product phone shot / depth field / 3D wordmark”
- Draft looks wrong (black particles, empty frame, no shadow) → timeline / translator
- Choosing `quality` / `--draft` / `--final` / cache bust
- Pre-ship 3D gate before `adversarial-critique`

**Hand off elsewhere:** 2D motion look → `motion-design`. VO lock / typed chrome →
`speech-synced-ui`. Trailer structure → `video-production`. Caption/logo overlap →
`adversarial-critique`.

## Prerequisites

Blender **≥ 4.2** required for any `.scene.js` beat:

```bash
brew install --cask blender    # or export KINO_BLENDER=/path/to/blender
kino doctor                    # expect: Blender X.Y (…)
```

No Blender → build fails on the named beat with an install hint. Non-3D specs don't need it.

## Prefer presets first

| Id | Job | Must-set params |
|---|---|---|
| `phone-orbit` | Device product shot | `screenshot` (project asset path — `.png`/`.jpg` still or `.html` animated screen) |
| `depth-particles` | Abstract depth / loop field | optional `intensity`, `color` |
| `wordmark-3d` | CTA extruded mark | optional `text`, `depth` |

Bare id in the spec (`"source": "phone-orbit"`) resolves from `assets-lib/motion/`.
Copy a preset into `assets/motion/` only when params aren't enough — keep choreography
absolute (camera setters) and seam-safe (`env.edge` / full-turn loops).

## Spec shape

```json
{
  "kind": "motion",
  "source": "phone-orbit",
  "text": "…",
  "quality": "draft",
  "params": { "screenshot": "shots/dash.png", "spin": 0.4 },
  "keyframes": [{ "atWord": "dashboard", "params": { "zoom": 1.3 }, "ease": "overshoot" }]
}
```

- `quality`: `draft` | `final` | `max` (optional). Unauthored on `kino build` → **final** (Cycles 128).
- `kino storyboard` / `kino still` default **draft** (Eevee). Opt into Cycles with `--final`.
- `kino build --draft` forces Eevee for every scene beat.

## Iterate without melting the machine

1. **Author / tweak** `.scene.js` + params (presets or `assets/motion/…`).
2. **`kino doctor`** — Blender row green.
3. **`kino storyboard <spec>`** — Eevee drafts for the whole piece (~minutes, not hours).
4. **`kino still <spec> --segment N --around <t>`** — entrance / mid / settle for one beat.
5. Fix from stills (lighting/choreography/params) — **not** from imagining Cycles.
6. **`kino still … --segment N --final`** (or full `kino build`) when draft reads grounded.
7. **`adversarial-critique`** on the sheet / final still — caption clearance, safe zones.
8. Re-renders of unchanged beats are free: cache is `out/<title>/_scene3d/<hash>/`.

**Budget (Apple Silicon, 1080×1920):** draft = seconds/frame; Cycles final ≈ **5–15 min/beat**.
Wipe `_scene3d/` only when translator constants change (lights live in Python, not the hash).

## Module contract (don't violate)

- Body of `scene(api)` runs **once**; must `return (env) => { … }`.
- `update(env)` is a **pure function of `env`** — no accumulation, no `Math.random`/`Date`.
- Camera rig setters are **absolute** (`dolly(z)` sets Z; calling twice with `5` stays at 5).
- **Build-time vs per-frame params:**

| Read | When | Keyframeable? |
|---|---|---|
| `api.params.X` / `api.param("X")` in body | once at build | **No** |
| `env.params.X` in `update` | every frame | **Yes** |

- Lint: `lintSceneJs` — no `require`/`import`/`process`/DOM/network/timers.
- Ground truth members: read `recordApi.ts`. Doc table: `docs/3d-scenes.md`.

## Craft bar (what “good” looks like)

| Beat type | Must read on a draft still |
|---|---|
| Phone | Screen UI legible; body has clearcoat sheen; soft contact shadow / ground; not edge-on at settle |
| Layered SVG / HTML screen | Each element crisp at rest; visible depth separation on camera move; no halo on alpha edges; screen UI state lands on spoken words |
| Particles | Colored points visible (mint/gold), depth, seam-safe if looping (`env.edge`) |
| Wordmark | Metal has tonal modeling (not flat grey blob); grounded; fit-to-frame (bbox shim is approximate) |

Stay on brand palette (`mint`/`green`/`night`/`white`/`gold`). One hero artifact. Caption band
clearance on product shots (phone settle often sits above lower-third).

## Debug empty / black / wrong

1. Open `out/<title>/_scene3d/<hash>/timeline.json` — objects, `world`, camera, materials.
2. Check PNG alpha: empty frame → camera `lookAt` / dolly; black mesh → lights / emissive particles.
3. Asset paths: `api.texture(api.param("screenshot"))` needs a real staged file under `assets/`.
4. After editing `kino_render.py` only: `rm -rf out/<title>/_scene3d` then re-storyboard (hash
   ignores Python constants).

## Related

- `docs/3d-scenes.md` — full contract, quality tiers, api table
- `src/render/scene/recordApi.ts` — api surface
- `scripts/kino_render.py` — Blender translator (studio lights, materials)
- `assets-lib/motion/*.scene.js` — presets
- `skills/motion-design` — 2D visual craft
- `skills/adversarial-critique` — frame QA
- `skills/video-production` — trailer / ship gate
