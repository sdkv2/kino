# kino advert — design spec

**Date:** 2026-07-19
**Status:** approved (design), pending implementation plan
**Deliverable:** a ~22s 9:16 looping advert for kino, produced *in* kino → `projects/kino-meta/out/advert/…mp4`

---

## Concept

**"There's no magic. Just tell your agent."**

An honest meta-reveal. The video opens on a stylised spoof **kino AI window**; the prompt
*"Kino, make me an advert"* types itself in perfect sync with the voiceover. Then it pulls the
curtain: there is no chatbot — your **coding agent writes a spec**, **one command builds it**, and the
very frames you are watching assemble on screen. It ends by **echoing the prompt** and **looping**
seamlessly back to that prompt being typed — the way auto-generating demo reels loop on a landing page.

**Zero captions.** Every on-screen word is a motion graphic locked to the VO (via `env.words`), not the
caption engine. Faceless (`provider: none`) → $0 avatar spend; the product/UI *is* the star.

### Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Honesty of the framing | **Honest meta-reveal** — spoof prompt is the hook, then the real flow (agent → spec → `kino build` → this video) |
| "Someone typing" | **Caret + keystrokes in-window** — pure motion graphics, deterministic, no footage |
| Length / depth | **Tight ~22s** — one spoof-window sequence + compact how-it-works + CTA |
| Loop | **Seamless** — first frame ≡ last frame; end echoes the prompt, loops into it being typed |
| Sound | Quiet ambient bed + light UI SFX (removable) |

### Concept frames (pre-viz, image-gen)

Four approved concept frames define the visual language (in `scratchpad/concepts/`, to be copied into
`projects/kino-meta/assets/gen/`):

- `01-hero-window.png` — the prompt window: midnight ground, mint glow border, `kino ●` wordmark, prompt line + mint block caret + send arrow. **This is the loop poster frame.**
- `02-spec-editor.png` — dark editor, JSON spec, mint/gold syntax highlighting, glowing caret.
- `03-build-terminal.png` — `> kino build advert.json` + vertical pipeline (voiceover ✓ / compose ✓ / render ● / mp4 ○).
- `04-cta-endcard.png` — `kino` wordmark, mint→gold radial glow, tagline, gold CTA pill.

> Concept art only. The real motion graphics use kino's **actual** schema keys and **actual** positioning
> (README: "Agent-driven short-form video production") — no invented tagline or fake schema.

---

## Brand: `kino`

No `kino` brand exists yet; create `brands/kino/brand.md`. Palette is kino's real default
(`src/config/brand.ts:125`):

| Token | Hex | Role |
|---|---|---|
| night | `#0b1020` | ground (midnight blue-black) |
| mint | `#80e2b4` | primary accent / active glow / caret |
| green | `#0c8d64` | deep accent |
| gold | `#d99a20` | secondary accent / progress / CTA pill |
| white | `#ffffff` | body text |

- **Fonts:** a clean display/UI sans (`font`) + a **mono** `labelFont` for the terminal/spec/typed surfaces (confirm against `kino fonts`).
- **Voice:** calm, confident, cinematic. `defaultVoice` = Rachel (`21m00Tcm4TlvDq8ikWAM`, calm narrator) or Antoni (warm M) — final pick in the brand step.
- **`voiceModel: eleven_multilingual_v2`** — typed-in-sync needs metronome-stable timing; v3 drifts.
- **`defaultProvider: none`**, **`film: 0`** (see Look & finish).
- **Tone / Voice** body written via the `ad-voice` skill (not the scaffold placeholder).

---

## Storyboard (6 beats, ~22s)

All beats are `kind: "motion"`, all **omit `caption`** (no caption node mounts). VO drives all timing.

| # | ~s | Surface | VO (draft → ad-voice) | Motion (≥3 layers) |
|---|----|----|----|----|
| 0 | 0–4 | **Prompt window** `prompt-window.js` | "Kino… make me an advert." | Settled window (**no entrance pop**); burst-typewriter types prompt from `env.words`; block caret; slow `.cam` push-in on the field (off `env.t`) |
| 1 | 4–6 | **Same window, thinking** `thinking-window.js` | "There's no magic here." | Camera pulls back to native; mint thinking-dots `kino-pulse`; send-arrow flick |
| 2 | 6–11 | **Spec editor** `spec-editor.js` | "Your agent writes a spec —" | Real kino schema keys (`segments`, `kind:"motion"`, `text`) type in sync (`env.words`); gentle pan down; line-number gutter |
| 3 | 11–15 | **Build terminal** `build-terminal.js` | "— one command builds it. Voiceover, motion, render." | `kino build advert.json` types; pipeline steps illuminate top→down; `kino-pulse` on each spoken step |
| 4 | 15–18 | **Range tiles** `range-tiles.js` | "Captions, avatars, motion — all of it." | Spec segments "ignite" into 3 staggered capability tiles (caption / counter / framed-phone) via `sibling-index()` |
| 5 | 18–22 | **CTA → loop-close** `close-window.js` | "Kino. Tell your agent to make it." → *echo:* "Kino, make me an advert." | CTA lockup (wordmark + gold pill, frame-04 glow) over the **returning window**; last ~0.4s: lockup fades, window settles to **empty input + solid caret ≡ Frame 0**. Same generator as beat 0 → seam is exact |
| ↻ | | **loops into Beat 0** | *(types the words the echo just said)* | echo→type match is the loop payoff |

**Camera continuity:** beats 0→1 are the same window (push-in, then pull-back to native) so the cut to the
editor (beat 2) doesn't pop. Beat 5 returns to native scale to match Frame 0.

---

## The seamless loop (hard constraint)

**First frame ≡ last frame** = the clean **empty prompt-window** (input empty, `kino ●` wordmark
top-left, caret **solid**, native scale). The ad springs from and returns to this one poster frame, so
`<video autoplay muted loop>` has an invisible seam.

Consequences baked into the design:

1. **No window entrance pop on beat 0** — Frame 0 is the settled window (a mid-pop frame 0 would not match the end). Life comes from caret + typing.
2. **Static grain/vignette only** — kino's injected `kino-grain`/`kino-vignette` are frame-independent (identical at frame 0 and the last frame). No `--t`-animated texture, or the seam shimmers.
3. **Caret forced solid** for the final ~5 frames of beat 5 *and* the first ~5 frames of beat 0 → no blink-phase discontinuity at the seam.
4. **Shared window generator** — beat-5's close renders the *same* markup/geometry/scale as beat-0's `t=0` state (both from `gen-windows.py`), so the seam is pixel-identical.
5. **Audio:** the visual seam is perfect; audio is not gapless (end VO ≠ beat-0 start). Music bed fades out the last ~1.5s / in the first ~0.8s so a bed-only or muted loop (how hero reels autoplay) is clean. A gapless-audio variant is out of scope.

---

## Look & finish

- **`film: 0`** at spec level. The build's cinematic finish (vignette + grain) applies to `app`/photographic
  beats, never motion beats — and this ad is near-all-motion. Setting `film: 0` keeps any stray non-motion
  beat flat; the cinematic finish is hand-rolled **inside** each graphic via `kino-grain` / `kino-vignette`
  (static → loop-safe) for a uniform look.
- **Shared window generator** `gen-windows.py` → `prompt-window.js` (beat 0), `thinking-window.js` (beat 1),
  and the beat-5 close ready-state — so window chrome never drifts across beats 0/1/5. (Pattern from
  `speech-synced-ui` → worked example.)
- **Typed grain = burst-typewriter** (chars ~45ms apart at each word's front, then hold), not word-block
  reveal (which reads as caption drip). Reads env.words per `docs/motion-graphics.md` → *Typed-in-sync text*.
- **Camera** driven off `env.t` / `--progress` on a `.cam` wrapper — never the typed-character count (that lurches once per keystroke).
- **vw units** for resolution independence; stacks mid-frame (`top: ~40%`), clear of platform chrome.

---

## Sound & voice

- **Music:** quiet ambient bed `{ "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }`, `fadeIn` short. Sourced via `kino music` (Freesound CC0). Fades at both ends for the loop.
- **SFX (optional, light):** soft key-clicks under the typing bursts, a send-pop on submit, a soft chime on build-complete. Placed **after real VO** via `kino audio-markers` → `sfx[].at` → rebuild (VO cached). Omit if a silent bed is preferred.
- **VO:** `eleven_multilingual_v2`, calm cinematic read. Final line **echoes the prompt** so it "says the prompt at the end" and matches the loop-back typing.

---

## Assets to build

```
brands/kino/brand.md                    # palette, sans + mono fonts, voice, voiceModel v2, film:0, Tone/Voice (ad-voice)
projects/kino-meta/
  project.json                          # brand: kino
  assets/gen/                           # the 4 approved concept frames (reference + possible textures)
  assets/motion/
    gen-windows.py  → prompt-window.js  # beat 0 — chrome + burst typewriter + camera
                    → thinking-window.js# beat 1 — thinking dots + camera pull-back
                    → close-window.js   # beat 5 — CTA lockup → settle to ready-state ≡ Frame 0
    spec-editor.js                      # beat 2 — real schema keys typing, env.words, pan
    build-terminal.js                   # beat 3 — kino build + pipeline, kino-pulse
    range-tiles.js                      # beat 4 — capability triptych, staggered
  specs/advert.json                     # 6 beats, no captions, provider none, film:0, music bed
```

---

## Execution phases (input to writing-plans)

0. **Build the linchpin.** `npm run build` — the `env.words` / `wordsShown` / `wordCount` feature is
   uncommitted WIP on `feat/motion-word-timings` and the CLI runs `dist`. Smoke-test that `env.words` is
   populated in a trivial motion beat **before** building on it. (Verified present in source:
   `src/render/remotion/MotionGraphic.tsx`, `src/render/motionVars.ts`.)
1. **Scaffold** brand + project (`kino projects --new kino-meta --brand kino`); write `brand.md`
   (Tone/Voice via `ad-voice`); copy the 4 concepts into `assets/gen`.
2. **Author the motion graphics** — windows via `gen-windows.py` (→ prompt / thinking / close); `spec-editor.js`; `build-terminal.js`; `range-tiles.js`.
3. **Write `advert.json`** — 6 beats, no captions, `provider: none`, `film: 0`, VO copy via `ad-voice`, music bed.
4. **Mock loop, per motion beat** (free): `kino inspect` → `kino still --segment N` (layout) →
   `kino still --around <word-time>` (typing / camera / pulse progression) → **Read the sheet** → edit →
   repeat. Pick `--around` centers from `kino inspect` word times.
5. **Storyboard + critique:** `kino storyboard` → `adversarial-critique` (attach `--around` sheets for typed/motion beats).
6. **Real build:** `kino build advert.json` (real VO, v2) → `kino inspect --real` →
   `kino still/frames --around <t> --real` on every typed/motion beat → retune `KEY_MS` / camera / triggers to real word times.
6.5. **Loop-seam verification:** pixel-diff beat-0 frame 0 vs beat-5 final frame (must match — deterministic);
   `kino frames` the mp4 at both ends and eyeball the seam by concatenating end→start.
7. **Sound:** `kino music` → bed; `kino audio-markers` → `sfx[].at` → rebuild (VO cached).
8. **Ship:** final `adversarial-critique` on real frames → `projects/kino-meta/out/advert/…mp4` (designed for `autoplay muted loop`).

---

## Risks

| Risk | Mitigation |
|---|---|
| `env.words` is uncommitted WIP — the typed-to-speech core depends on it | Phase 0 builds `dist` + smoke-tests it before anything else. Fallback: CSS `--kino-words-shown` word-grain (reads more like caption-drip). Source verified present. |
| Loop seam visibly jumps | Hard constraints above (settled frame 0, static grain, solid caret, shared generator); explicit phase-6.5 pixel-diff. |
| Mock word times ≠ real VO → typing desyncs | Phase 6 retunes `KEY_MS` / camera / triggers against `inspect --real` + `--around --real` sheets. |
| Honest framing weakens the "magic" hook | The hook is still the magic prompt; the reveal is the differentiator for kino's real audience (devs + coding agents). |
| Renderer bug vs spec mistake | Per `video-production` hard rule: if a render bug is suspected, stop and report before patching `src/render/**` (shared across all brands). |

---

## Out of scope (YAGNI)

- Literal infinite recursion in the meta-punch (finished file inside itself) — a `✓ advert.mp4` done-state / echo delivers the payoff.
- Real other-brand output footage in beat 4 — kino-branded capability tiles are honest and avoid borrowing.
- Gapless-audio loop variant / GIF/WebM exports — mp4 with matched bookend frames covers the ask.
- Avatar provider — faceless is cheaper and stronger for a product/UI story.
