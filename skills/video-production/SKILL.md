---
name: video-production
description: Use when producing short-form vertical marketing videos for an app (TikTok/Reels/Shorts) with the `kino` CLI — AI avatar presenter + app screen footage + voiceover + captions. Covers authoring the video spec, the build workflow, and the cost/compliance guardrails.
---

# Producing videos with kino

`kino` turns a JSON **spec you author** into a finished 9:16 (and optional 3:4) video.
You supply the creative; the CLI handles VO (ElevenLabs) → avatar (optional) → composite (Remotion).

## Workflow
1. `kino doctor` — confirm ffmpeg and the keys for your chosen provider are present.
   (`kino fonts` lists fonts settable as `brand.font`/`brand.labelFont` — downloaded on demand.)
   Brands are **optional markdown** — `brands/<name>/brand.md` (YAML frontmatter for palette/font/voice/
   disclosure + a free-form guidelines body with a **Tone / Voice** section). Run `kino brand <name>` to
   read a brand's styling + tone rules; with no brand, kino uses its defaults. (Set the brand via
   `spec.brand` or a project's `project.json`.)
2. Author a spec (schema below). **Copy:** read `ad-voice` skill before writing segment `text`/`caption`
   — follow the brand's Tone / Voice dial, then the anti-slop rules. Keep captions short; never claim
   guaranteed jobs/interviews.
3. **Iterate (fast, free):** `kino inspect specs/foo.json` to map the beats, then
   `kino still specs/foo.json --segment N` (one frame, ~1–2s) or `kino storyboard specs/foo.json`
   (each beat twice — composition + the **·full** reveal; check the ·full tile for captions that
   overflow the frame or collide with a `texts` overlay). Edit the spec, re-preview. These default to mock (zero spend).
   **Before shipping a storyboard as "done":** run the `adversarial-critique` skill (subagent frame QA).
4. `kino build specs/foo.json` — real render → `out/<title>/`. (`kino frames <mp4> --at …` for post-build QA.)
   Re-run `adversarial-critique` on post-build frames when layout could have shifted with real VO timing.

**Projects** keep campaigns tidy: `projects/<name>/{specs,assets,out}` + a `project.json` that assigns a
shared brand and default overrides. Run any command on a spec inside a project (kino infers it from the
path) or pass `--project <name>`. `kino projects --new <name> --brand <brand>` scaffolds one. The flat
layout (no `project.json`) still works.

## Avatar provider (cost lever — pick deliberately)
Set per spec with `"provider"`, or per brand with `defaultProvider`, or override with `--provider`:
- **`none` (faceless)** — no avatar; app footage + VO + captions only. **$0 avatar cost**, and the
  strongest format for app installs because it shows the product. Default for most videos.
- **`heygen`** — Avatar-IV hosted look. Highest quality, most expensive (~20 credits/min). Needs a look id.
- **`hedra`** — Character-3. Cheap API + free monthly tier. Needs `brand.avatarImage` (a portrait).
- **`replicate`** — open-source lip-sync (default SadTalker). Pennies/clip. Needs `brand.avatarImage`.

Two automatic savings when an avatar IS used: the avatar is **trimmed to the on-camera segments only**
(app cut-ins aren't billed), and VO + avatar are **content-hash cached** so caption/motion edits don't re-bill.

## Spec schema
```jsonc
{ "brand": "<brand>", "title": "kebab-case", "format": ["9:16"], "voice": "<alias>",
  "provider": "none",            // none | heygen | hedra | replicate (else brand.defaultProvider)
  "background": "mesh",          // faceless bg: glow|image|mesh|aurora|particles|grid|custom (else brand.background)
  "segments": [
    { "kind": "avatar", "text": "spoken (+ lip-synced if an avatar provider is set)", "caption": "on-screen text", "cta": true },
    { "kind": "app", "asset": "screens/x.png", "text": "spoken (avatar hidden)", "caption": "...",
      "captionMode": "words", "emphasis": ["claim"],  // optional: spoken text, word-synced + highlighted
      "kicker": { "text": "86% match", "color": "mint" } } ] }
```

**Trailer shape — adapt, don't stamp.** A ~20–30s / 7–9-beat trailer runs OPENER → a MIDDLE that shows the product → PAYOFF + CTA. The **opener is a menu**, not a fixed format: a caption-card hook (`avatar`), a cold open on your strongest footage (`app`), or a motion title card (`motion`) — pick what the brand wants. One proven layout for a footage-driven trailer:

```
0  avatar   hook — the problem/tension, one big line   (opener is a menu: or cold-open on app / a motion title)
1  app      footage — establish the world
2  app      footage — show the product truth      ← beats 1–3: sequence related shots; consecutive app
3  app      footage — the payoff moment              beats auto-crossfade, so it reads as an edited montage
4  motion   a data/feature beat (counter, timer…)  ← media ≈ half the runtime
5  avatar   payoff — the emotional turn
6  avatar   CTA (cta: true) — brand name + URL, anchored low
```
**Footage-cut rules:** match each clip's length to its beat's VO; vary the `shot` per cut-in to the action (push-in / pan / pull-out); keep related shots back-to-back for the auto-crossfade; set the brand's `captionStyle.background` backplate so captions stay legible over uncontrolled footage.

## Short-form layout defaults (TikTok / Reels / Shorts)

**Default to this composition unless the brand guidelines explicitly ask otherwise.** Agents over-tween
layout and crowd the top chrome — don't.

| Layer | Default | Don't |
|---|---|---|
| Hook (`avatar`, faceless) | Centered hero caption — big, calm, no `captionKeyframes` | Pin to top edge; `y: -16` "for variety" |
| App / footage captions | Lower-third (engine default) + brand backplate | Per-beat `y`/`scale` jitters |
| CTA (`cta: true`) | Lower-third automatically — use `captionReveal: "all"` | Fake with `captionKeyframes` `y`; leave as centered hero |
| Kickers | Top pill (engine default) — fine; not a CTA | Treat kicker as the end card |
| `texts[]` labels | Small, `position: "top"` (or clear of caption band) | Drop a second headline into the lower-third on CTA |
| Motion / counters | Stack **mid-frame**: CSS `.wrap { top: 38%–42%; }` (no tiny `translateY(20vw)`), clear of caption band + top UI | Park the graphic in the top ~20% (Following/For You chrome) |
| Music | Quiet bed `"volume": 0.10–0.14`, `"duck": 0.04`, short `fadeOutSec` | Loud beds fighting VO/captions |
| Logo | `logoPosition: top`, simple fade-in — hold steady | Tween logo `y` on the CTA beat |

**Caption stability is the default.** Omit `captionKeyframes` on a first pass. Add one only when a
single beat must dodge a bright subject (check that still) — never a different `y` on every beat.

**CTA placement:** `cta: true` on a faceless avatar beat forces the **lower-third** band (not the
centered hero). The flag is wired through the renderer — trust it.

**Motion-beat recipe** (counters, timers, big numbers):

```css
/* assets/motion/*.html — short-form safe */
.wrap {
  position: absolute; left: 0; right: 0;
  top: 40%;                          /* below platform chrome; above lower-third caption */
  display: flex; flex-direction: column; align-items: center;
}
/* Keep the stack ≤ ~50vw tall so it doesn't collide with the caption band (~CAPTION_BOTTOM). */
```

Preview motion with `kino still --segment <n>` before the real build. If the graphic kisses the
caption or sits under the top UI, nudge `top` — don't reintroduce per-caption `y` offsets to compensate.

- `avatar` segments are the on-camera/hook/payoff beats; `app` segments show the screenshot/recording while the VO continues. (Faceless still uses these kinds — `avatar` beats become branded caption cards.)
- **Emphasis is a spice, not a sauce** — `emphasis` adds a glow to the marked word while it's spoken.
  Cap it at one word (max two) per beat, on the single word carrying the claim; several emphasised
  words per beat reads as noise and devalues all of them. Beats can (and often should) have none.
- **Key the highlight colour for contrast** — the active (spoken) word and the brand name render in
  `colors.mint`. Choose it to pop against the background luminance: a *bright* accent over a dark
  ground, a deep one over a light ground. A dark saturated accent (deep red, navy) on a near-black
  background reads dimmer than the white body text, so the one word meant to pop recedes — if the
  brand's signature colour is dark, keep the active word bright and carry that colour in the background
  or `texts` overlays instead.
- **Media density**: caption cards are connective tissue, not the show — viewers stay for footage,
  screenshots, and motion. Target roughly **half the runtime on media** (`app` cut-ins, `motion`
  beats, motionOverlays): in a ~20s spec that's 2-3 `app` beats + at least one `motion`/Lottie
  moment. Never run more than two plain caption-card beats back-to-back; break the pattern with a
  cut-in or overlay. **Compose each caption card for what its beat says, not to a template** — the
  monotony that reads as a slideshow comes from framing every beat as the same centered line. Fit the
  frame to the content: a short hook can go big (centered, or only slightly raised — never pinned to the top edge), a full sentence sits calmer and centered, a
  two-part contrast can split, the CTA anchors low with the wordmark/URL; add a `texts` label only
  where the beat earns one. Variety is the *result* of composing per beat, not the goal — two beats
  that genuinely want the same frame may share it. The failure is every beat defaulting to dead-center
  because none was composed for what it says (don't jitter position just to make cards differ — that
  reads as noise, not design). B-roll sources: project assets, `kino pexels`, `assets-lib/lottie/`.
  **Consecutive `app` beats crossfade shot-to-shot automatically** (the first holds under the next's
  fade-in — no background flash between them), so sequencing related footage back-to-back is
  encouraged: it reads as edited film, not a slideshow.
- **Camera/transitions auto-vary** — omit and `kino` picks a varied shot + transition per cut-in.
  Override per segment with `"shot"` (`push-in`/`pull-out`/`pan-left`/`pan-right`/`tilt-up`/`static`,
  plus `scroll`/`scroll-up` to pan vertically through a **tall** app still — a simulated scroll that
  reveals content below the frame; opt-in, so it's never auto-picked)
  and, on `app` segments, `"transition"` (`fade`/`dissolve`/`fly-left`/`fly-up`/`pop`/`cut`).
  Auto-vary is asset-aware: video b-roll defaults to the soft pair (`dissolve`/`fade`) and UI stills
  to the punchy rotation — match that instinct when overriding (footage wants a natural fade, not a
  spring fly-in). **Plan shot variety before writing the spec, not after seeing the storyboard**: for
  3+ consecutive `app` beats, jot the camera move per beat first — auto-vary picks per-cut, not
  across the whole run, so an unlucky repeat (three push-ins) can still slip through unless you skim
  your own list for repeats before building.
- **Faceless backgrounds animate**: `kino backgrounds` lists each preset's params (colours/intensity) +
  actions (pulse). Tween them over time with `backgroundKeyframes` and fire `backgroundTriggers` at
  timestamps; sync to the VO using per-word times from `kino inspect`.
- **Overlay elements tween** (`kino elements`): the logo has `logoSize` (small/medium/big/px) +
  `logoPosition` (top/bottom/left/right/center/{x,y}%) and `logoKeyframes`; captions + kickers tween via
  per-segment `captionKeyframes` / `kickerKeyframes` — all x/y/scale/opacity over time, same keyframe system.
- **Stylised captions**: `captionStyle` (`stroke`/`highlight`/`gradient`/`minimal`, default `stroke`) and
  `captionAnimation` (`pop`/`rise`/`typewriter`/`wave`/`blur-in`/`none`, default = the surface's native
  entrance) set top-level or per-segment (segment overrides spec overrides brand). **`captionReveal`**
  (words mode, default `word`) sets how the line arrives: `word` pops each word in at its VO time; `all`
  lays the whole caption out and fades it in together, the active word still highlighting as the VO reaches
  it — use `all` (or `phrase` mode) for a **CTA or any long line**, since a word-by-word reveal of a long
  line strands its first word at a wrapped corner during a VO pause. Per-segment
  `texts: [{ text, at, dur?, position?, size?, style?, animation? }]` drops standalone headline overlays
  anywhere on the frame (slot + small/medium/big, independent of the segment's own caption) — keep them
  clear of the caption's band so the two can't collide (the ·full storyboard tile shows collisions). Details +
  the style/animation tables in `reference.md`.
- **Motion graphics** (`kino motion`): for a fully custom animated beat or overlay, author a
  self-contained HTML/CSS file in `assets/motion/` and reference it from the spec — a full-screen
  beat (`{ "kind": "motion", "source": "motion/x.html", "text": "spoken VO" }`) or an overlay on an
  app/avatar beat (`"motionOverlay": { "source": "motion/x.html" }`). **You write the HTML/CSS; the
  JSON owns timing.** **Layout first (short-form):** put the stack mid-frame (`.wrap { top: 40%; }`) —
  see [Short-form layout defaults](#short-form-layout-defaults-tiktok--reels--shorts). A
  `translateY(20–28vw)` from the top lands under TikTok/Reels chrome; don't ship that. Animate by
  reading kino-set CSS variables — `--progress` (0→1 over the beat), `--t`, `--frame`, `--pulse`,
  your `params` (e.g. `--pct`, tweened by `keyframes`), and the brand palette (`--kino-mint` etc.).
  Two font vars are available too: `--kino-font` (the caption font) and `--kino-label-font`
  (`brand.labelFont`, falls back to `--kino-font` if the brand sets none) — pair a display face on
  the hero number with a mono/label face on a supporting chip instead of reusing one font
  everywhere. You can also use real **`@keyframes`** — add `class="kino-anim"` and kino force-pauses
  + scrubs them across the beat deterministically (sub-timing in the `%` stops, stagger via
  `--kino-delay`). **No CSS `transition`/JS and don't set `animation-play-state`** — motion is
  always frame-driven (CSS variables or scrubbed `@keyframes`). For gradient-filled text
  (`background-clip:text`) with tight/negative `letter-spacing`, add `class="kino-cliptext"` so the
  last glyph's edge keeps its gradient instead of being clipped. For loops/computed geometry, point
  `source` at a `.js` file whose body is `render(env)` returning an HTML string (evaluated per frame,
  determinism-linted) instead of a `.html` file. **Stagger reveals** so things don't all land at once — auto-stagger a
  list with `sibling-index()` (`--d: calc((sibling-index() - 1) * .08)`), give each element its own
  slice of `--progress`, or use a param-per-element with offset keyframe `at` times for spring/ease
  control. Run `kino motion` for the full contract, the stagger recipes, and a copyable example;
  preview with `kino still`/`storyboard` like any other beat.
  **Tier-3 Lottie (`.json`):** point `source` at a designer-authored Bodymovin/LottieFiles `.json` file
  to embed organic illustrated motion or AE-produced animations that an agent can't hand-author. kino
  plays it deterministically via `@remotion/lottie`. Key rule: for a `motionOverlay`, the asset **must
  have a transparent background** — an opaque export occludes the avatar or app screenshot. Add
  `"loop": true` (sibling of `source`) to loop at native speed; default plays once stretched across the
  beat. **Word-fire:** give the Lottie `triggers` at VO word times (from `kino inspect`) and each fires a
  fresh one-shot burst in sync with the words (use a short, transparent burst asset; triggers override
  stretch/loop). Assets must embed images (base64 `data:` URIs) and outline/embed fonts (no system fonts,
  no AE expressions). Works in all three motion slots (`kind:"motion"`, `motionOverlay` on `avatar` or `app`).
  **Ready-made library:** `assets-lib/lottie/` (repo root) holds pre-cleaned, brand-neutral LottieFiles
  templates (wave background, card carousels, logo reveal) — copy into the project's `assets/motion/`
  and reference directly. Rebrand a logo/image slot by replacing the image asset's base64 `p` payload.
  When adapting fresh LottieFiles downloads yourself, see "Sourcing from LottieFiles" in
  docs/motion-graphics.md — notably: strip the `fh`/`fs`/`fb` block creator exports stamp on text
  animators (renders all text red in lottie-web), delete the near-universal opaque `Background` layer,
  and don't rewrite template text (glyphs are baked; only exported characters render).
- **Check copy for cross-beat redundancy before the first preview**: a `motion` beat's on-screen
  label/dial text and the VO caption for that beat (or the one next to it) can end up saying the same
  thing twice (a timer graphic labelled "START TO FINISH" under a caption reading "start to finish,
  about twenty minutes"). Read the full beat list — spoken lines + any `texts`/motion labels — start
  to finish, script only, before building the storyboard.
- **Target the middle of your runtime range, not the floor**: if `kino inspect`'s mock estimate lands
  at or below your minimum, don't assume the real VO will pace it out to a comfortable length — pad
  now (a beat, a slightly longer line, more breathing room on the hook/payoff) rather than shipping
  the edge and calling it a known weakness after the real build.

## Stock b-roll (Pexels)
When a beat needs real-world footage the brand assets can't provide — lifestyle shots, environments,
hands-on-phone, city texture — pull licensed stock video instead of settling for a static screenshot:
`kino pexels "city commute at night"` lists portrait clips (duration, size, author, thumbnail URL),
then `kino pexels "city commute at night" --get 2 --project <name>` downloads into `assets/pexels/<id>.mp4`.
**Screen the local thumb before downloading**: search prints `thumb: /tmp/kino-pexels-thumbs/<id>.jpg`
— Read that file and reject on composition/mood there. Don't curl the remote URL by hand.
Downloading full clips just to preview burns bandwidth for candidates you were never going to use.
Only `--get` the ones you'd plausibly cut in.
Reference it from an `app` segment like any asset (`"asset": "pexels/<id>.mp4"` — .mp4 assets play
with the same shots/transitions as stills). Prefer real product footage when it exists; match the
clip's duration to the beat's VO length (durations are listed). Needs `PEXELS_API_KEY` (free — pexels.com/api).
**Caption legibility over footage is not optional:** stock/photographic clips have uncontrolled
luminance, so before shipping a spec with video (or busy screenshot) cut-ins, make sure the brand
sets `captionStyle.background` (the translucent lower-third backplate, `appOnly` by default) — ink
captions straight on dark footage disappear. Same check for kickers: pick a kicker `color` whose
brand chip contrasts with the footage (preview with `kino still --segment <n>` before a real build).
**The backplate helps average luminance, not a bright subject sitting right under the text** — a white
caption over a white shirt/wall/sky can still fail even with the plate on, if the plate's opacity is
low or the caption sits squarely on the brightest part of the frame. Check the specific region behind
the caption, not just "is there a backplate": if it's still weak, reposition the caption off the bright
area (`captionKeyframes`) rather than only raising opacity.
No repo example currently sequences real Pexels footage end-to-end across a full spec — don't burn
time searching `projects/*/specs/` for one; build the beat sequencing straight from this schema.
Search caches local thumbs under `$TMPDIR/kino-pexels-thumbs/<id>.jpg` — **Read those paths** to
screen composition/mood (don't curl the remote URL by hand).

## Sound (music + SFX)
Every production-ready trailer needs a ducked music bed. **Do not scrape Mixkit / Pixabay /
Bensound / random CDNs** — they 403, return empty bodies, or waste the run.

```
kino music                              # bundled beds + short-form Freesound query ideas
kino music "soft ambient pad loop"      # Freesound CC0 search (needs FREESOUND_API_KEY)
kino music "soft ambient pad loop" --get 2 --project <name>
# in the spec (short-form: quiet bed, hard duck — VO wins on TikTok/Reels/Shorts):
"music": { "src": "ambient-night", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }
"sfx": [ { "src": "whoosh", "at": 2.5, "volume": 0.35 } ]
```

- Bare ids resolve from `assets-lib/music/` / `assets-lib/sfx/` (`kino music`, `kino doctor`).
- Freesound search is **CC0 + 15–90s** by default (fits a 15–30s cut). Catalog skews ambient/SFX —
  good beds, not chart songs. **Platform trending audio is not pullable** (copyright).
- Short-form taste: sparse bed under VO; cut whooshes matter more than a busy track; avoid loud
  drums fighting captions.
- **Place SFX after the real VO exists**: `kino build` → `kino inspect --real` and/or
  `kino audio-markers` → set `sfx[].at` → rebuild (VO cached). Guessing `at` mid-word is not shipping.

## Hard rules (the CLI enforces these — don't fight them)
- **HeyGen looks must be Avatar-IV photo-avatars** — list valid ones with `kino avatars` (add
  `--gender male|female` to narrow). Brand `lookAliases` map a friendly name → look id. For
  `hedra`/`replicate`, set `brand.avatarImage` (a portrait file) instead — those engines lip-sync a
  source image, not a hosted id.
- Voices: `kino voices` (add `--gender male|female` to narrow). Match voice age/gender to the avatar,
  and to the **brand's
  personality**: don't leave every brand on the same default voice. If `kino voices` 401s (a scoped
  key without voices_read), these premade ElevenLabs voices work on every account — pick by character:
  `21m00Tcm4TlvDq8ikWAM` Rachel (calm narrative F) · `AZnzlk1XvdvUeBnXmlld` Domi (confident, punchy F) ·
  `EXAVITQu4vr4xnSDxMaL` Sarah (soft, warm F) · `ErXwobaYiN019PkySvjV` Antoni (warm, easy M) ·
  `TxGEqnHWrfWFTfGW9XjX` Josh (deep, serious M) · `pNInz6obpgDQGcFmaJgB` Adam (broadcast M).
  Set it per spec (`"voice"`) or per brand (`defaultVoice`).
- **Expressive VO (audio tags)**: set spec `"voiceModel": "eleven_v3"` and direct the read inline in
  segment text with bracketed tags — `[excited]`, `[whispers]`, `[sighs]`, `[laughs]`, `[curious]`,
  `[short pause]`. Tags are stripped from word-synced captions automatically. Use like emphasis: 1-2
  tags per spec where the copy earns them (a hook, a reveal), not on every beat. v3 reads are less
  timing-stable than v2 — keep it off metronome-critical specs. Faceless only for now: with an avatar
  provider the tagged text also reaches lip-sync, untested.
- **Timing comes from the generated VO**, not your guesses — don't put timestamps in the spec.
- Banned outcome phrases (get the job, guaranteed interview, …) fail the build — keep copy honest.
- Use `--mock` while iterating to avoid avatar credit spend; real builds cache VO+avatar so edits to
  captions don't re-bill. Faceless real builds spend only ElevenLabs (no avatar credits at all).
- **Suspect a rendering bug (not a spec mistake)? Stop and say so before patching render source.**
  The render pipeline (`src/render/**`) is shared across every brand and spec — a fix there is correct
  for everyone or wrong for everyone, unlike a spec/brand tweak scoped to the one video you're making.
  Report what you saw (still/frame + what's wrong) and the suspected file/line, and confirm before
  editing it. Don't reason your way to "this falls within scope" solo on a task that was to produce a
  video, not patch the renderer.

## Adversarial visual critique

Layout QA is a **separate skill** — read and follow `adversarial-critique` after storyboard (and after
real-build frames when timing can shift layout). Do not inline a self-check of `storyboard.png` instead.

## Analysing reference videos (research only)

Use `kino transcribe <video>` / `kino scan <video>` ONLY to study external reference clips
(competitors, trending videos, downloaded reference footage). They transcribe speech to timestamped
text and pull frames so you can see what's said and shown.

Never use them on our own rendered output (we already have word timings from TTS — use `kino
inspect`), and never inside the build pipeline. See `reference.md` for flags.

See `reference.md` for command flags, brand config, and troubleshooting.
