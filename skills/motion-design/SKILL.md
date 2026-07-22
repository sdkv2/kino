---
name: motion-design
description: >
  Use when authoring or critiquing kino motion graphics (Tier-1 HTML, Tier-2 JS,
  motionOverlay, library pages) — composition, color, type, camera/choreography,
  spoof-UI craft, and anti-generic checks. Companion to speech-synced-ui (VO lock)
  and video-production (trailer structure). Not for ordinary captions or footage edit.
---

# Designing motion graphics in kino

Contract and lint live in `docs/motion-graphics.md` / `kino motion`. VO lock and
typed chrome live in `speech-synced-ui`. **This skill is the visual brief** — how a
beat should look and move so it feels authored for *this* brand, not like a stock
template dropped on 9:16.

Edit real `assets/motion/*` (or bare-id library sources). Prove with `kino still` /
`--around` / `frames`. Do not ship a vibe described only in markdown.

## When to Read this

- New `kind:"motion"` or `motionOverlay` from scratch
- Polish that is about hierarchy, palette use, chrome craft, or “why does this feel AI”
- Choosing camera / entrance / life after the mechanic already works
- Pre-ship visual pass before `adversarial-critique`

**Hand off elsewhere:** VO wording → `ad-voice`. Beat list / cold open → `video-production`.
Character burst typing / retune → `speech-synced-ui`. Overlap with captions/logo →
`adversarial-critique`. Real 3D (`.scene.js` / Blender) → `3d-scenes`.

## Beat job first (composition follows work)

Name the **job of this beat** before drawing boxes. Layout and motion follow that job.

| Job | What the frame must do | Typical motion |
|---|---|---|
| **Hook** | Category + product readable in ~1s | Fast entrance, one hero mass, little chrome noise |
| **Demonstrate** | Show a real product artifact (prompt, editor, pipeline, digest…) | Speech-locked reveals; camera serves the artifact |
| **Prove** | Make a claim believable (number, before/after, named steps) | Stagger only what the VO enumerates |
| **Orient** | Teach a surface (where to look next) | Soft life; avoid competing pulses |
| **CTA / settle** | End or loop-ready poster | Native scale, calm field, no leftover entrance energy |

A centered stack of equal pills is fine **only** when the job is “compare N equal steps.”
It is wrong when the job is “one claim + one proof object.”

### Prompt invariants (refuse drift)

Extract before drawing:

- **Name** — product/brand as given (on-screen chrome, not a smoother rename)
- **Category** — what kind of thing this is (first readable second)
- **Audience pressure** — skim vs inspect (TikTok skim ≠ product demo inspect)
- **Artifact** — the concrete object of the domain (journal entry, deploy log, JSON spec…)
- **Evidence** — what would make a skeptic trust the beat
- **Refuse** — leftover chrome, copy, or palette habits from the last project

If the hero object could drop into an unrelated ad without looking wrong, it is too generic.
Rebuild around the artifact.

## Register: brand film vs product instrument

- **Brand film** — the graphic *is* the ad moment. Expressive camera, statement color, art-directed
  chrome OK. Arrival feeling is part of the deliverable.
- **Product instrument** — spoof UI that must read as a real tool. Consistency, legibility, and
  speech lock beat flourish. Operators (even fictional ones) should parse the surface instantly.

Most kino beats are brand film *using* a product instrument as proof. Let the instrument stay
honest; put flourish in camera, wash, and pulse — not in fake buttons that fight the product.

## Color (mood with brand tokens)

Kino injects `--kino-mint` `--kino-green` `--kino-night` `--kino-white` `--kino-gold` (and fonts).
Build atmosphere from those roles — do not invent a parallel rainbow unless brand.md demands it.

Decide the **emotional arc of the beat** before saturating:

1. Arrival feel (calm / urgency / play)
2. Where attention must spike (accent rarity)
3. Rest surfaces (field that does not compete with type)

Commitment levels (pick one per beat):

- **Whisper** — night/neutral field; one role color does the work (default for dense UI spoofs)
- **Statement** — one hue owns a large plane (wash, hero numeral, CTA field)
- **Conversation** — a few roles with jobs (status / accent / mute) — pipelines, multi-chip digests
- **Flood** — the surface *is* the color (rare; cold opens and logo locks)

Accent that appears everywhere stops meaning anything. Tint “gray” UI chrome toward brand hue so
panels feel related, not stock dark-mode. Avoid the reflex blue-violet / indigo-cyan energy wash —
if the palette could belong to any AI startup after removing the wordmark, rechoose.

Contrast still matters on a phone in sunlight: light type on dark needs weight + tracking; thin
mint hairlines vanish on encode.

## Type (shape of the claim)

Use `--kino-font` / `--kino-label-font`. Size in **`vw`** so 9:16 and preview panes stay honest.

Hierarchy: usually **three** levels on a beat — hook (hero), bridge (unit label), detail (chips,
gutter, foot meta). Flat scales look uncommitted; more than three fights the VO.

Short labels (chips): tight leading, letter-space for uppercase brand chrome.
Hero numerals / italic display: optically heavy enough to survive H.264.

System/default stacks are fine for product spoofs when brand.md says so; brand film should not
default to the same safe sans every project.

Keep graphic text clear of the caption band: `--kino-caption-bottom`. Prefer omitting captions on
dense typed beats (`speech-synced-ui`).

## Layout (directing a 9:16 shot)

You are staging one composition, not a dashboard.

- **Squint / still test** — `kino still --segment N` then blur the PNG. Can you name the three most
  important masses? If not, hierarchy failed.
- **One proof object** owns the middle third; chrome (title bar, feet, chips) supports it.
- **Planes** — background (`.bg` / wash), content (window + type), attention (caret, pulse, CTA).
  When planes fight, the beat feels noisy. For loops, background must be seam-safe (static `.bg` or
  life gated by `sin(progress·π)`).
- **Rhythm** — pick a small spacing ladder in `vw` (micro / component / section) and stick to it.
  Random gaps read as unfinished.
- **Cards** — only when the content is truly card-shaped (discrete, scannable units). Nested cards
  and equal feature tiles are usually habit. Prefer type + dividers + one window.
- **Safe zones** — TikTok/Reels UI eats edges; keep labels and CTAs inside the readable column.
  `still --platform` / storyboard overlays help.
- **Mass** — a heavy hero bottom-right needs a counterweight (mark or negative space) so the
  frame does not tip.
- **Fill budget** — name the container, name what fills it. If content occupies less than ~half the
  container, either shrink the container to the content or add a rest plane *with a stated reason*.
  No accidental voids — a background band ≥25% of the frame with nothing in it is a bug, not breathing
  room, unless you can say why it rests there.
- **Alignment axis** — every repeated group (list rows, chips, steps, icon+label pairs) shares one
  declared axis; nothing floats a few px off. Dynamic/revealed lists **group-center in their available
  space** — never top-align rows inside a fixed-tall shell (they sink and open a void below the title).

Wrappers that exist only to “contain” create dead margins. If removing a shell does not hurt
reading, remove it.

## Motion is character (frame-scrubbed)

In kino, motion is a **pure function of frame state** (`--progress`, eased `--kino-*` curves,
`--pulse`, `env.words`, params/keyframes). Wall-clock CSS transitions lie at render time.

Prefer **eased progress** over linear `--progress` for entrances and camera:

| Var / `env.*` | Curve | Use |
|---|---|---|
| `--kino-out` / `env.out` | ease-out cubic | Soft landings, camera push |
| `--kino-inout` / `env.inout` | smoothstep | Symmetric ramps |
| `--kino-overshoot` / `env.overshoot` | back-out (may >1) | Scale pops |
| `--kino-spring` / `env.spring` | elastic-out (may >1) | Rare punchy brand moments |
| `--kino-edge` / `env.edge` | `sin(π·progress)` | Seam-safe wash/breath (0 at beat edges) |

`--pulse` attacks in ~45ms then decays — pair with `.kino-pulse` or additive chip emphasis. Do not
hand-roll `(1-p)*(1-p)` when `env.out` / `--kino-out` already exists.

Motion may say: this arrived, this is the spoken step, this is processing, this settled for loop,
this is the pulse on that noun. Motion may not say “look at me” with no cause.

### Timing taste

- Entrances: short enough that VO is not waiting on chrome; long enough to feel intentional
- Speech-locked reveals beat fixed clocks (mock VO lies — retune after real TTS)
- Exits / settles faster than entrances; loop posters return to **native scale**
- Life after settle: quiet brands breathe via `--kino-edge`; punchy brands keep a soft wash or caret
- Prefer transform/opacity (and deliberate blur/mask). Layout thrash costs encode quality.

Weight: big windows and full-bleed washes move slower than carets and chips. Elastic/bounce is a
rare brand joke, not a default on every pulse.

Stagger only when order must be understood (pipeline steps, chip list synced to VO). Uniform
mechanical delays feel generated — vary slightly or drive from word starts.

Camera lives in a `.cam` wrapper driven by **time** (`env.out` / `env.edge`), not by typed character
count (`speech-synced-ui`). Soft mid-beat breath; native scale at beat edges so dissolves do not
zoom-pop.

## Spoof UI as interaction theater

Ads are not clickable, but the surface still needs **readable states** across the beat:

| Beat-time state | Design for it |
|---|---|
| Idle / ready | Loop poster, empty field, solid caret policy |
| Entering | Opacity/scale path that finishes before the first critical word |
| Speaking / typing | Burst type or word gates; caret solid while keys land |
| Highlighted step | Pulse + chip/row emphasis on the spoken noun |
| Settling | Clear thresholds on `progress` (never `=== 1`); seam match |

Empty and “done” must look intentional. A half-typed field with a dead caret at loop point is a bug.

On-screen microcopy follows `ad-voice`: one clear verb on CTAs, no filler, sentence case, no
desperate punctuation. Chrome labels must use the **same nouns the VO speaks** or chips will lie.

## Generic-tell sniff (fix the reflex, not the pixel)

If a stranger could say “AI ad template” in two seconds, stop polishing glow and change the
decision that caused it.

Common kino odors:

- Violet/cyan energy gradients / stock **mesh** behind caption cards with no custom stage
- Equal feature tiles / chip rows with no spoken priority
- Frosted glass everywhere instead of a depth plan
- Oversized orphan stats with no product artifact
- Bounce/elastic on every pulse
- Centered everything because no composition was chosen
- Domain costume only (journal = cream serif; CLI = pure green phosphor) with zero specific artifact
- Chrome recycled from the last promo (wrong mark, wrong filename)

Wanted instead: a color commitment level, type with a reason, one domain artifact, motion that
explains speech or settle, and a first frame that could only be this product.

## 3D scenes (`.scene.js`)

Real geometry (phone product shot, depth field, extruded wordmark) → **`3d-scenes` skill**
(Blender drafts/finals, presets, quality CLI). Do not force that look in CSS. Visual taste still
applies (one artifact, brand palette, caption clearance) — run `3d-scenes` for the pipeline.

## Craft loop (truthful completion)

1. Sketch the beat job + artifact in one sentence.
2. Implement in `assets/motion/…` using brand tokens + `vw`.
3. `kino still <spec> --segment N` — hierarchy / safe zone / caption clearance. Overlay a mental
   3×3 grid: any empty row/column or ≥25% dead band → fix fill budget + alignment before moving on.
4. `kino still … --around <t>` (or harness) — entrance, speech lock, camera, pulse.
5. Real VO → `inspect --real` → `retune` → `frames <mp4> --around <t>`.
6. Loop ads: still at 0 vs settle end; trust PSNR/seam, not raw AE.
7. Only claim “improved hierarchy / motion / color” when the sheet or mp4 shows it.

Scope: if the user asks to fix one caret, do not restyle the whole window. If they ask for a visual
pass on the beat, run the full checklist above.

## Related

- `docs/motion-graphics.md` — CSS/JS contract, lint, helpers
- `docs/3d-scenes.md` — `.scene.js` contract (detail); workflow → `skills/3d-scenes`
- `skills/3d-scenes` — Blender 3D beats, presets, draft/final gate
- `skills/speech-synced-ui` — typing grain, camera, seamless loop, retune
- `skills/video-production` — trailer structure, brand discovery, ship gate
- `skills/adversarial-critique` — overlap / safe-zone frame QA
- `assets-lib/motion/` — copyable pages to adapt, not paste blindly
