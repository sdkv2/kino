---
name: video-production
description: Use when producing short-form vertical marketing videos for an app (TikTok/Reels/Shorts) with the `kino` CLI — AI avatar presenter + app screen footage + voiceover + captions. Covers authoring the video spec, the build workflow, and the cost/compliance guardrails.
---

# Producing videos with kino

`kino` turns a JSON **spec you author** into a finished 9:16 (and optional 3:4) video.
You supply the creative; the CLI handles VO (ElevenLabs) → avatar (optional) → composite (kino's frame engine).

## Brand discovery (before creating a new brand)

**Don't scaffold an empty brand and invent a personality.** When a spec needs a brand that doesn't exist yet:

1. **Reuse first.** `kino brand` lists existing brands — if one fits, use it (`spec.brand`/`project.json`)
   or copy the nearest `brands/<name>/brand.md` as a starting point. A new brand is for a genuinely new
   product, not a variation you can express per spec.
2. **Ask the owner** for what only they hold: product truth (what it does, who it's for), real palette +
   fonts, logo file, platform, tone, and any legal/disclosure constraints or banned phrases. Draft from
   product truth and get approval — never fabricate a look or voice.
3. **Gather from what's already here** (don't invent what the repo can show you):
   - `brands/*/brand.md` — the nearest brand as the pattern for frontmatter + guidelines shape
   - `projects/<name>/assets/{screens,recordings}` — real app stills: read the **actual** palette + type
     off the product, don't guess hex codes
   - the logo / brand kit the user drops in → `brands/<name>/assets/`
   - `kino fonts` · `kino voices` · `kino backgrounds` — what's settable (font/labelFont, defaultVoice, background)
   - `assets-lib/` — shared motion/backgrounds the brand can lean on (music/sfx ship empty)
   - **or more** (with permission): the app's App Store listing / site / press kit for public brand assets;
     `kino pexels` / `kino photos` / image-gen for stills the brand lacks
4. **Then scaffold** `kino init <brand>` and fill `brands/<brand>/brand.md` from what you discovered —
   frontmatter (palette/font/voice/disclosure) + a real **Tone / Voice** body (read `ad-voice`), not the
   placeholder scaffold. Confirm palette + Tone/Voice with the owner before mass-producing specs.

## Workflow
1. `kino doctor` — confirm ffmpeg and the keys for your chosen provider are present.
   (`kino fonts` lists fonts settable as `brand.font`/`brand.labelFont` — downloaded on demand.)
   Brands are **optional markdown** — `brands/<name>/brand.md` (YAML frontmatter for palette/font/voice/
   disclosure + a free-form guidelines body with a **Tone / Voice** section). Run `kino brand <name>` to
   read a brand's styling + tone rules; with no brand, kino uses its defaults. (Set the brand via
   `spec.brand` or a project's `project.json`.) **New brand? Do Brand discovery (above) first.**
2. Author a spec (schema below). **Opener:** prefer a cold open on your strongest footage (see Trailer
   shape) before a mesh caption card. **Copy:** read `ad-voice` skill before writing segment `text`/`caption`
   — follow the brand's Tone / Voice dial, then the anti-slop rules. Keep captions short.
   **Typed UI / caption-free montage / spoof chat window:** read `speech-synced-ui` — captions are optional;
   stylised speech-locked typing lives in motion graphics (`env.words`), not the caption engine.
   **Look / hierarchy / anti-generic craft** for those graphics: `motion-design`.
3. **Iterate (fast, free):** `kino inspect specs/foo.json` to map the beats, then **look at pixels** —
   never trust the JSON alone for motion/Lottie. Defaults are mock (zero spend).
   If mock `durationSec` ≤ ~20 on a 20–30s brief, **pad VO lines before storyboard** (both mock
   promos landed short on first inspect).
   - `kino still specs/foo.json --segment N` — layout / composition of one beat (~1–2s)
   - `kino still specs/foo.json --around <sec>` — **required for any animated beat** (typewriter,
     counters, Lottie, camera push): sheets N frames around a moment so progression is visible in
     one image (default 5 frames / 1s window; tune `--span` / `--count`)
   - `kino storyboard specs/foo.json` — every beat twice (composition + **·full**); check ·full for
     caption overflow / `texts` collisions
   Edit → still/`--around` again → repeat. **Before shipping a storyboard as "done":** run
   `adversarial-critique` (subagent frame QA) — include `--around` sheets for motion/Lottie beats.
4. `kino build specs/foo.json` — real render → `out/<title>/`. Post-build: `kino inspect --real` for
   word times, then `kino frames <mp4> --around <sec>` (or `kino still … --around <sec> --real`) on
   every motion/Lottie/typed beat — mock timing lies; retune triggers / KEY_MS / camera from the sheet.
   Re-run `adversarial-critique` when layout could have shifted with real VO.

**Projects** keep campaigns tidy: `projects/<name>/{specs,assets,out}` + a `project.json` that assigns a
shared brand and default overrides. Run any command on a spec inside a project (kino infers it from the
path) or pass `--project <name>`. `kino projects --new <name> [--brand <brand>]` scaffolds one (brand
optional — omitted = kino house defaults). Specs must
live under a project — there is no flat layout.

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
  "background": "custom",        // faceless: prefer custom+backgroundComponent over mesh for brand identity
  "backgroundComponent": "brand-wash", // bare id → assets-lib/backgrounds/ (or path / brand field)
  "segments": [
    { "kind": "avatar", "text": "spoken (+ lip-synced if an avatar provider is set)", "caption": "on-screen text (optional — omit on any kind for a caption-free beat)", "cta": true },
    { "kind": "app", "asset": "screens/x.png", "text": "spoken (avatar hidden)", "caption": "...",
      "captionMode": "words", "emphasis": ["claim"],  // optional: spoken text, word-synced + highlighted
      "kicker": { "text": "86% match", "color": "mint" } } ] }
```

**Caption-free beats:** omit `caption` → no caption node. Under a **words-mode brand**, also set
`"captionMode": "phrase"` on that beat or synced spoken words still paint. Stylised typed prompts
(terminal/chat) → `speech-synced-ui`, not a caption with fancy `captionStyle`.

**⚠ Words-mode vs short lower-thirds (field trap):** brand `captionMode: words` paints the **spoken
VO** on screen — the short `caption` string is *not* what appears. Want a punchy scroller line over
busy UI/plates? Override that beat with `"captionMode": "phrase"` + short `caption`. Want silence?
`phrase` + omit `caption`. Typed motion: same (`phrase` + omit). Both Driftlog + VoltStack mock
promos burned a pass on this.

**Trailer shape — adapt, don't stamp.** A ~20–30s / 7–9-beat trailer runs OPENER → a MIDDLE that shows the product → PAYOFF + CTA.

**Opener = scroll-stop first.** TikTok/Reels thumbs and the first ~1s decide whether anyone hears the VO. Prefer a
**cold open on your strongest footage** (`app`: product screen, real-world b-roll, or the most kinetic clip you have)
with a short hook caption over it. Mesh/glow/aurora caption cards (`avatar`) and motion title cards stay **valid** —
use them when the brand is deliberately quiet/editorial, when you truly have no usable footage yet, or when a typographic
cold open *is* the brand move — but do **not** default to a soft blurred mesh + centered line just because faceless
trailers used to start that way. If the first still could be any SaaS ad after you squint, the opener is too weak.

Opener menu (pick one; bias toward #1 for consumer/app ads):

1. **Cold open (`app`)** — default lean. Strongest clip + one hook line (lower-third + backplate). Optional kicker.
   `shot: "push-in"` + `transition: "cut"` reads as a thumb-stop. Caption stays short (`which hold?`, not the full VO).
2. **Motion title (`motion`)** — brand-forward graphic cold open when the product truth *is* a number/diagram.
3. **Caption card (`avatar`)** — faceless hero on `background` mesh/glow/aurora. Fine for quiet/luxury brands or
   copy-led hooks; still compose it (big line, hot palette intensity, not a muddy mid-grey blur). Never open on the
   brand name (ad-voice rule).

One proven layout for a footage-driven trailer (cold-open first):

```
0  app      cold open — strongest footage + hook caption   ← scroll-stop; not a mesh card by default
1  app      footage — establish the world / product surface
2  app      footage — show the product truth          ← consecutive app beats auto-crossfade = montage
3  app      footage — the payoff moment
4  motion   a data/feature beat (counter, timer…)     ← media ≈ half the runtime
5  avatar   payoff — the emotional turn (caption card OK here)
6  avatar   CTA (cta: true) — brand name + action as a **centered end card** (hero), not a lower-third subtitle
```

**Footage-cut rules:** match each clip's length to its beat's VO; vary the `shot` per cut-in to the action (push-in / pan / pull-out); keep related shots back-to-back for the auto-crossfade; set the brand's `captionStyle.background` backplate so captions stay legible over uncontrolled footage. **Plan the opener clip before writing beat 0 copy** — pick the thumb-stopping frame, then write the one-line caption that rides it.

**Source recordings (long captures):** when slicing a screen recording / imported clip into multiple
beats, or seating footage in custom chrome, follow the `importing-footage` skill (`clipFrom` /
`clipTo` / `speed` / `pauseAt` / `frame`) — don't guess timestamps without reading stills.
**Framed beats:** `shot: "static"` only (no push-in / pan) — renderer enforces this.

## Short-form layout defaults (TikTok / Reels / Shorts)

**Default to this composition unless the brand guidelines explicitly ask otherwise.** Agents over-tween
layout and crowd the top chrome — don't.

| Layer | Default | Don't |
|---|---|---|
| Hook / cold open (`app`) | Strongest footage first; short lower-third caption + backplate; optional kicker | Soft mesh card as the default opener; brand-name first line |
| Hook (`avatar`, faceless) | Centered hero caption — big, calm, no `captionKeyframes` (use when caption-card opener is intentional) | Pin to top edge; `y: -16` "for variety"; muddy low-contrast mesh behind a weak line |
| App / footage captions | Lower-third (engine default) + brand backplate | Per-beat `y`/`scale` jitters |
| CTA (`cta: true`) | **Centered end card** (hero) — short brand + action; `captionReveal: "all"` or `captionMode: "phrase"` | Park the CTA in the lower-third caption gutter; word-by-word drip on a long App Store line; empty mesh with no brand mark |
| Kickers | Top pill — fine when the still has empty top chrome | Treat kicker as the end card; **kicker on a feed/chip still that already labels the moment** |
| `texts[]` labels | Small, `position: "top"` (or clear of caption band) | Second headline fighting the CTA end card |
| Motion / counters | Stack **mid-frame**: CSS `.wrap { top: 38%–42%; }` (no tiny `translateY(20vw)`), clear of caption band + top UI | Park the graphic in the top ~20% (Following/For You chrome) |
| Music | Quiet bed `"volume": 0.10–0.14`, `"duck": 0.04`, short `fadeOutSec` | Loud beds fighting VO/captions |
| Logo | `logoPosition: top` on talking runs; CTA `center` only if mark clears hero type | Omit logo when CTA caption already names the brand (double mark); tiny lower-third as the whole ending |

**Caption stability is the default.** Omit `captionKeyframes` on a first pass. Add one only when a
single beat must dodge a bright subject (check that still) — never a different `y` on every beat.

**CTA = end card, not a subtitle.** `cta: true` on a faceless avatar beat uses the **centered hero**
surface (same as other faceless talking beats). **`cta: true` is avatar-only — the CLI rejects it on a
`motion` or `app` beat (`cta is avatar-only`).** A motion end-card graphic (baked wordmark + button, or
a `texts` CTA) already *is* the end card; keep it plain `kind:"motion"` and carry the CTA copy in the
graphic/`texts`, not via `cta: true`. **Two valid faceless CTA shapes:** (a) `kind:"avatar"` +
`provider:"none"` **with** `cta:true` (the centered-hero caption surface — add a `motionOverlay` for a
wordmark if you want the graphic), or (b) a pure `kind:"motion"` end-card **without** `cta:true`. "Faceless"
comes from `provider:"none"`, not the segment kind — an `avatar` beat is still faceless. Write a short caption (`Cadence · free to try`, not a
full spoken sentence). Prefer `captionMode: "phrase"` or `captionReveal: "all"` so the line lands as
one poster, not a word drip. Logo is optional: if the caption already carries the brand name, **omit
`brand.logo`** — a centered mark + centered wordmark fights. Otherwise put the mark mid/top so the
frame isn't empty mesh + type. Stronger: end on an `app` still of the product, then a short hero CTA
beat — never a lone lower-third pill on blank mesh.

**Screen PNG margins:** bake empty top/bottom bands into product stills when you use `push-in` /
captions — chrome baked into the image (`12 CAPTURES`, status rows) gets cropped by camera zoom.
Prefer padding in the asset over fighting layout in the spec. **Assets taller than 9:16 (standard
19.5:9 iPhone screenshots / marketing composites, e.g. 1320×2868) are cover-cropped top+bottom *even
when `static`* — not only under zoom.** A headline baked at the extreme top/bottom (marketing plates)
gets clipped; keep essential text inside the centre ~80%, or use a raw screen / a plate authored at
9:16 for a text-carrying beat. (`ffprobe <asset>` to check the aspect before you seat it.) There is no
in-spec letterbox/`contain` fit — so if your only plate is taller than 9:16 (the bundled
`marketing-*.png` / `presets.png` are 19.5:9), either accept the top/bottom crop or don't hang a VO
line that names the text the crop eats.

**Motion-beat recipe** (counters, timers, big numbers): layout mid-frame, then **animate** — see
[Make motion graphics move](#make-motion-graphics-move) (≥3 layers: entrance + life + speech/camera).

```css
/* assets/motion/*.html — short-form safe */
.wrap {
  position: absolute; left: 0; right: 0;
  top: 40%;                          /* below platform chrome; above lower-third caption */
  display: flex; flex-direction: column; align-items: center;
}
/* Keep the stack ≤ ~50vw tall so it doesn't collide with the caption band (~CAPTION_BOTTOM). */
```

Preview with `kino still --segment <n>` (layout) **and** `kino still --around <t>` (motion richness)
before the real build. If the graphic kisses the caption or sits under the top UI, nudge `top` —
don't reintroduce per-caption `y` offsets to compensate.

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
  two-part contrast can split, the CTA is a **centered end card** with the wordmark/action; add a `texts` label only
  where the beat earns one. Variety is the *result* of composing per beat, not the goal — two beats
  that genuinely want the same frame may share it. The failure is every beat defaulting to dead-center
  because none was composed for what it says (don't jitter position just to make cards differ — that
  reads as noise, not design). B-roll sources: project assets, `kino pexels` / `kino photos`.
  **Consecutive `app` beats crossfade shot-to-shot automatically** (the first holds under the next's
  fade-in — no background flash between them), so sequencing related footage back-to-back is
  encouraged: it reads as edited film, not a slideshow. **Consecutive `motion` beats dissolve the
  same way** (~0.5s hold-through-gap + fade-in; first motion stays opaque for loop seams — see
  `speech-synced-ui` → *Motion→motion handoffs*).
- **Camera/transitions auto-vary** — omit and `kino` picks a varied shot + transition per cut-in.
  Override per segment with `"shot"` (`push-in`/`pull-out`/`pan-left`/`pan-right`/`tilt-up`/`static`,
  plus `scroll`/`scroll-up` to pan vertically through a **tall** app still — a simulated scroll that
  reveals content below the frame; opt-in, so it's never auto-picked)
  and, on `app` segments, `"transition"` (`fade`/`dissolve`/`fly-left`/`fly-up`/`pop`/`cut`).
  Auto-vary is asset-aware: video b-roll defaults to the soft pair (`dissolve`/`fade`) and UI stills
  to the punchy rotation — match that instinct when overriding (footage wants a natural fade, not a
  spring fly-in). **Plan shot variety before writing the spec, not after seeing the storyboard**: for
  3+ consecutive `app` beats, jot the camera move **and** transition per beat first (CONCEPT.md) —
  auto-vary picks per-cut, not across the whole run, so an unlucky repeat (three push-ins) slips
  through unless you skim your own list. Tall stills (~2200px+) earn `scroll`; 9:16 plates do not.
- **Faceless backgrounds** (`kino backgrounds`): **do not *default* to `mesh`** — but a brand whose
  `brand.md` deliberately sets `mesh` + tuned `backgroundColors` **is** brand-correct; keep it (the CLI
  nag is generic and can't tell a brand-set mesh from a lazy default). Set mesh colours via brand
  frontmatter `backgroundColors`, or per-spec via `backgroundKeyframes` params `colorA/colorB/colorC` (a
  single keyframe sets a constant; two animate) — there is **no** top-level `backgroundColors` spec key
  (strict schema rejects it). Stock mesh/aurora
  with no colour work is the generic tell. Prefer:
  - `"background": "custom"` + `"backgroundComponent": "brand-wash"` (or your draw fn) for authored identity
  - `"solid"` when `seamlessLoop` / settle (no global-frame drift)
  - `"image"` + `facelessBackdrop` for photo stages
  - a full-bleed `.bg` inside motion graphics (occludes the faceless layer entirely)
  Spec `backgroundComponent` overrides brand. Tween with `backgroundKeyframes` / `backgroundTriggers`;
  sync to VO via `kino inspect`. See `docs/backgrounds-and-overlays.md`.
- **Overlay elements tween** (`kino elements`): the logo has `logoSize` (small/medium/big/px) +
  `logoPosition` (top/bottom/left/right/center/{x,y}%) and `logoKeyframes`; captions + kickers tween via
  per-segment `captionKeyframes` / `kickerKeyframes` — all x/y/scale/opacity over time, same keyframe system.
- **Camera push on app footage** (`zoomKeyframes`, per `app` segment): scales/pans the footage **+ frame
  chrome** as one group about centre — the "canvas zoom" for inset iPhone footage. The phone grows/pushes
  in; captions, kicker, logo and the background stay anchored. **Beat-relative** track (`at` = seconds from
  the beat's start, `0` = beat start — it rides the beat, so re-timing the video never desyncs it), params
  `scale`/`x`/`y`/`opacity`; one keyframe = static hold, two = animated push. A `frame` disables the inner
  `shot`, so `shot:"static"` + `zoomKeyframes` is the way to move the camera on device footage. See
  `importing-footage`. **Motion graphics** do **not** use `zoomKeyframes` — zoom/pan there is a CSS
  `transform` on a wrapper driven by `--progress` / a keyframed param / typed fraction (`speech-synced-ui`).
  A zooming `motionOverlay` on a static PNG frame desyncs text from chrome; put chrome+text in one motion beat.
- **Stylised captions**: `captionStyle` (`stroke`/`highlight`/`gradient`/`minimal`, default `stroke`) and
  `captionAnimation` (`pop`/`rise`/`typewriter`/`wave`/`blur-in`/`none`, default = the surface's native
  entrance) set top-level or per-segment (segment overrides spec overrides brand). **`captionMode` sets
  the same way** — brand < spec < segment: a top-level `captionMode` is the spec-wide default, a segment
  overrides it (verify with `kino inspect`, which reports each beat's *resolved* mode). The spec schema
  is **`.strict()`**, so a misspelled or misplaced top-level key now **errors at parse** instead of being
  silently ignored — a typo surfaces immediately rather than being swallowed. **`captionReveal`**
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
  your `params` (e.g. `--pct`, tweened by `keyframes`), the brand palette (`--kino-mint` etc.),
  and **`--kino-words-shown` / `--kino-word-count`** (VO-locked typed UI). Tier-2 `.js` also gets
  **`env.words`** — beat-relative `{ word, start, end }[]` from the same TTS timings the caption
  engine uses. Use that for terminal/chat typing the caption presets can't style (`speech-synced-ui`).
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
  control. Run `kino motion` for the full contract, the stagger recipes, and a copyable example.
  **Preview is not optional** — see [Make motion graphics move](#make-motion-graphics-move) and
  [Motion / Lottie visual loop](#motion--lottie-visual-loop-use-still--around) below.
  **Tier-3 Lottie (`.json`):** point `source` at a designer-authored Bodymovin/LottieFiles `.json` file
  to embed organic illustrated motion or AE-produced animations that an agent can't hand-author. kino
  plays it deterministically with a frame-seeked Lottie player. Key rule: for a `motionOverlay`, the asset **must
  have a transparent background** — an opaque export occludes the avatar or app screenshot. Add
  `"loop": true` (sibling of `source`) to loop at native speed; default plays once stretched across the
  beat. **Word-fire:** give the Lottie `triggers` at VO word times (from `kino inspect`) and each fires a
  fresh one-shot burst in sync with the words (use a short, transparent burst asset; triggers override
  stretch/loop). Assets must embed images (base64 `data:` URIs) and outline/embed fonts (no system fonts,
  no AE expressions). Works in all three motion slots (`kind:"motion"`, `motionOverlay` on `avatar` or `app`).
  Rebrand a template's logo/image slot by replacing the image asset's base64 `p` payload.
  When adapting LottieFiles downloads: strip the `fh`/`fs`/`fb` block creator exports stamp on text
  animators (renders all text red in lottie-web), delete the near-universal opaque `Background` layer,
  and don't rewrite template text (glyphs are baked; only exported characters render).
  **After any Lottie adapt/rebrand:** `kino still --segment N` (layout + transparency) **and**
  `kino still --around <mid>` (stretch/loop/word-fire actually moves) before calling it done.

## Make motion graphics move

**Agents under-animate.** Default failure mode: a static card that only fades `opacity` with
`--progress`, then holds dead for half the beat. A motion beat should feel like **edited film**, not a
poster with a dissolve. Prefer **too much intentional motion** (then dial back) over a freeze.

### Minimum motion budget (every `kind:"motion"` / rich overlay)

Ship **at least 3 simultaneous layers** of motion on the beat (pick from the menu). Opacity-only
entrance counts as **one** — not enough by itself.

| Layer | Examples (use the toolkit) |
|---|---|
| **Entrance** | Staggered `kino-rise` / `kino-pop` / `kino-blur-rise`; scrubbed `@keyframes`; param tween with `overshoot`/`spring` |
| **Continuous life** | Slow drift/rotate/breathe off `--t` (`rotate(calc(var(--t)*12deg))`, subtle scale pulse); looping Lottie ornament; blinking caret |
| **Speech lock** | `env.words` / `--kino-words-shown` typing; Lottie `triggers` / `kino-pulse` on word times; counter `params` keyed to VO |
| **Camera / settle** | CSS `.cam` push-in or pan across the beat; end settle (scale back / opacity hold) so the last third isn't frozen |

### Design rules

1. **Stagger is mandatory** when ≥2 elements share the frame — `sibling-index()` + `--kino-delay`, or
   offset `--progress` slices. Everything landing on the same frame = slideshow.
2. **Something must keep moving after the entrance** — idle life (`--t`), looping Lottie, caret,
   shimmer, or a slow camera. A beat that finishes its reveal at `--progress:0.3` and sits still
   until the end is unfinished.
3. **Drive numbers/bars with `params` + `keyframes`**, not a static label. Prefer `ease: "overshoot"`
   or `"spring"` on the money moment; linear only for clocks/meters that should feel mechanical.
   Base `params` are an implicit t=0 keyframe, so `"params": {"pct": 0}` + one keyframe tweens 0→86.
   **Anchor to spoken words**: `{"atWord": "match", ...}` (word text or index) instead of `at`
   seconds wherever the moment belongs to a word — it resolves against the build's real VO, so
   nothing desyncs between mock and real. `at` stays beat-relative **seconds** for word-less moments.
4. **Punch the VO** — at least one visual accent on a spoken word (`triggers` → `kino-pulse`, word-fire
   Lottie, or a param jump). Silent motion + talking VO = disconnected.
5. **Multi-step UIs (pipelines, tile triptychs) light off `env.words`** when the VO names those steps —
   not a fixed `t0`/`per` clock. Fixed clocks finish early under real VO → dead tail. See
   [Real VO retune](#real-vo-retune-mandatory-before-ship).
6. **Prefer Lottie for organic loops/bursts** (dots, confetti, sparkle) over reinventing them in CSS —
   but don't bake headline copy into Lottie glyphs.
7. **Brand calm ≠ motionless.** Quiet brands still get soft continuous life + one clear entrance;
   loud brands get harder pops and word-fire. Match Tone/Voice amplitude, don't delete motion.

### Anti-patterns (reject on `--around` sheet)

- Only `opacity: var(--progress)` on one block
- All chips/words appear on the same tile of an `--around` sheet
- Counter/label never changes across the sheet
- End card wordmark static for the whole beat (no scale/fade/pan)
- Lottie stretched once with no loop and no triggers when the beat is >1.5s of “thinking”/ornament
- Pipeline/tiles all land in the first third of a long beat, then hold dead while VO continues
- On-screen step nouns ≠ spoken nouns

### Quick stack (copyable instincts)

```html
<!-- entrance + stagger -->
<div class="chip kino-pop" style="--kino-delay:calc((sibling-index()-1)*.08)">…</div>
<!-- continuous life -->
.orb { transform: rotate(calc(var(--t) * 25deg)) scale(calc(1 + 0.03*sin(var(--t)))); }
<!-- camera -->
.cam { transform: scale(calc(1 + 0.06*var(--progress))); transform-origin:50% 45%; }
```

```json
"params": { "pct": 0 },
"keyframes": [{ "at": 0.15, "params": { "pct": 86 }, "ease": "overshoot" }],
"triggers": [{ "at": 0.4, "action": "pulse" }]
```

Verify richness with `--around` — tiles should **look different** in a way that reads as craft, not
noise. See `kino motion` + `docs/motion-graphics.md` for the full contract.

## Motion / Lottie visual loop (use still + --around)

**Agents under-preview motion.** Treat every HTML/CSS/JS graphic and every Lottie as unfinished until
you have **Read** pixel stills at multiple stages — not just `inspect` JSON or one midpoint frame.

| Stage | Command | What you're checking |
|---|---|---|
| Scaffold / first paint | `kino still <spec> --segment N` | Layout, palette, caption clearance, opaque Lottie bg, chrome geometry |
| While tuning animation | `kino still <spec> --around <t>` (repeat often) | Progression **and** richness: typewriter, counter, camera, Lottie phase, stagger, idle life |
| Dense / short beats | `--around <t> --span 0.6 --count 7` | Sub-second motion that a 1s/5-frame sheet smears |
| Whole-cut layout | `kino storyboard <spec>` | Beat-to-beat jumps; ·full overflow/collisions |
| After real VO | `kino still … --around <t> --real` **or** `kino frames <mp4> --around <t>` | Speech lock (mock word times ≠ real); retune `triggers` / KEY_MS / params |
| Critique | `adversarial-critique` on stills **plus** `--around` sheets for motion/Lottie beats | Overlap + frozen + **under-animated** |

**Hard rules:**

1. **After every non-trivial edit** to a motion file, Lottie JSON, `keyframes`/`triggers`/`params`, or
   typed-UI proc → run `--around` on that beat (pick `t` near the interesting moment from
   `kino inspect`) and **Read the sheet image** before the next edit.
2. **Do not ship** a motion/Lottie beat that you have only seen as a single `still --segment` or
   storyboard midpoint — that frame can look fine while the animation is wrong **or missing**.
3. Prefer `--around` over hand-listing `--at a,b,c` unless you need uneven sample times; use
   `--montage` when you already have an `--at` list and want one sheet.
4. Typed UI / speech-locked surfaces → also follow `speech-synced-ui` (same still loop, stricter).
5. If the `--around` sheet barely changes → add layers from [Make motion graphics move](#make-motion-graphics-move),
   don't declare victory.
6. **`--segment N` is the beat midpoint, not t=0.** Loop posters / seam frames need
   `kino still … --at 0` (and `--at <beatEnd>` for the last frame). Midpoint stills lie about empty
   ready-states and end-of-beat clears.
7. **Preview before the expensive rebuild.** A full encode of a motion-heavy cut can take
   many minutes (~tens of minutes for ~20s @ 30fps of Tier-2 graphics). Keep **per-beat harness
   specs** (`specs/_b0.json` …) that render one motion source so you can `kino still --around`
   in seconds. Only `kino build` the assembled spec after harness sheets pass.
8. **Copy edits move the clock.** `--around` takes global seconds, and editing any beat's `text`
   re-paces every beat after it — sheet times derived before the edit now straddle beat edges
   (classic case: padding VO to hit runtime, then sheeting with pre-pad times). Prefer
   `kino still --segment N --word <w>` (always resolves against the current VO); for raw `--around`
   times, re-run `kino inspect` and re-derive every `t` after any copy change.

## Real VO retune (mandatory before ship)

Mock word times are evenly faked. **Real ElevenLabs timestamps differ** — fixed schedules
(`t0`/`per`, hardcoded `triggers`, progress-only reveals keyed to mock length) desync and leave
**dead tails** (animation finishes, VO still talking).

After the first real build:

1. `kino inspect <spec> --real` — note per-beat `start`/`end` and each word's times
2. `kino frames <mp4> --around <t>` on every speech-locked beat — Read the sheet
3. **Drive UI off `env.words`, not fixed clocks** — pipeline steps, capability tiles, counters that
   name spoken nouns should light when that word starts (fallback schedule only for mock/empty words)
4. Retune `triggers` / KEY_MS / clear thresholds from real times; rebuild (VO is content-hash
   cached — re-render is the cost, not re-TTS). `atWord`-anchored triggers/keyframes need **no**
   retune — they re-resolve against each build's VO; only hand-placed `at` seconds drift.
5. Re-check the loop seam on the **encoded mp4** (see below)

**Copy/VO lock:** on-screen labels that enumerate steps must use the **same nouns the VO speaks**
(e.g. chip `compose` + VO "motion" = 🟠). Align chip text to VO or VO to chips before ship.

## Seamless loops (hero reels)

When the brief is a looping site/hero video (first frame ≡ last frame):

1. **Own the background in every motion graphic** — paint a full-bleed `.bg` as the first layer.
   Brand presets like `mesh`/`aurora` animate off the **global** frame counter; occlude them.
   Animated grounds are OK if life is gated by `edge = sin(progress·π)` (0 at beat start/end) so
   seam frames match — see `speech-synced-ui` → *Seam-safe animated grounds*.
2. **Set `"seamlessLoop": true`** (+ prefer `"film": 0`). Validate warns on structure; post-build
   compares first/last RGB (warn only). Build also **holds the last video frame** to cover AAC
   audio pad — without that, players flash **black** for ~1–2 frames after the video track ends
   even when the true last picture is the ready poster.
3. **Motion→motion dissolves automatically** (~0.5s): outgoing beat holds through the VO gap,
   incoming fades in. First beat stays opaque (no fade-from-black). **`transition` is still
   app-only** (schema rejects it on motion) — you don't author the dissolve. For `app` openers use
   `"transition": "cut"` so nothing fades the cold open.
4. Design beat 0 t=0 and the final beat's end as the **same ready poster** (empty field, solid caret,
   **native scale S=1**, no CTA). Cameras: soft mid-beat breath only — **native at every beat edge**
   so cuts don't zoom-pop (`speech-synced-ui` → *Camera*). Prove with `kino still --at 0` vs settle
   end on harnesses (**lossless PNG AE=0**), then trust post-build seam / PSNR on the mp4.
5. **H.264 lies about AE.** Encoded first/last can differ by millions of AE from compression noise
   while looking identical. Gate with **PSNR / RMSE / fuzz**, not raw AE: PSNR ≳ 40 dB ≈ seamless.
6. `env.progress` never reaches exactly `1.0` (max ≈ `(frames-1)/frames`). End-of-beat clears /
   seam caret solid → use thresholds like `progress > 0.95`, never `progress === 1`.

Worked example: `projects/kino-meta/` (prompt → spec → build → settle loop). Typed-UI / camera /
handoff detail: `speech-synced-ui`.

- **Check copy for cross-beat redundancy before the first preview**: a `motion` beat's on-screen
  label/dial text and the VO caption for that beat (or the one next to it) can end up saying the same
  thing twice (a timer graphic labelled "START TO FINISH" under a caption reading "start to finish,
  about twenty minutes"). Read the full beat list — spoken lines + any `texts`/motion labels — start
  to finish, script only, before building the storyboard. Also check **VO nouns vs on-screen chips**.
  Same-frame counts too: on a typed beat the surface already paints the VO (`env.words`), so a
  foot/kicker label repeating that sentence duplicates it in one frame — give the label artifact
  meta instead (filename, line count), not the spoken claim.
- **Target the middle of your runtime range, not the floor**: if `kino inspect`'s mock estimate lands
  at or below your minimum, don't assume the real VO will pace it out to a comfortable length — pad
  now (a beat, a slightly longer line, more breathing room on the hook/payoff) rather than shipping
  the edge and calling it a known weakness after the real build.

## Stock stills (Pexels photos)
When a beat needs a **photograph** (lifestyle plate, texture, environment) and the brand has no
asset — same key as video, separate command:
`kino photos "coffee desk morning light"` lists portrait stills (size, author, alt + local thumb),
then `kino photos "coffee desk morning light" --get 2 --project <name>` → `assets/pexels/<id>.jpg`.
**Screen the local thumb before `--get`** (`thumb: $TMPDIR/kino-pexels-photo-thumbs/<id>.jpg` — Read
it). Reference like any still: `"asset": "pexels/<id>.jpg"`. Prefer real product screenshots when
they exist. Needs `PEXELS_API_KEY`.

## Generated stills (image gen)
When stock photos still won't fit (hero illustration, product mock, logo variant) — **use image gen
if the session permits it** (image-gen skill / host image tool available and the user hasn't
forbidden generated assets). Save into `assets/gen/…`. Don't invent UI chrome that misrepresents
the app. Skip when the tool isn't available or the brand bans AI art.

## Stock b-roll (Pexels video)
When a beat needs real-world **footage** the brand assets can't provide — lifestyle shots,
environments, hands-on-phone, city texture — pull licensed stock video:
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
kino music                              # library beds (ships empty) + short-form Freesound query ideas
kino music "soft ambient pad loop"      # Freesound CC0 search (needs FREESOUND_API_KEY)
kino music "soft ambient pad loop" --get 2 --project <name>
# in the spec (short-form: quiet bed, hard duck — VO wins on TikTok/Reels/Shorts):
"music": { "src": "music/bed.mp3", "volume": 0.12, "duck": 0.04, "fadeOutSec": 2 }
# SFX optional — omit by default, and assets-lib/sfx/ ships empty (add your own CC0 clip first).
# Soft pop/click only when a beat earns it (not every cut), referenced by project asset path:
# "sfx": [ { "src": "sfx/click.mp3", "at": 10.1, "volume": 0.25 } ]
```

- Neither library ships clips: music and SFX bare ids resolve from CC0 files you drop into
  `assets-lib/music/` / `assets-lib/sfx/`. Default route is a project asset path
  (`music/bed.mp3`, `sfx/<name>.mp3`) — sourced via `kino music` Freesound search or your own.
- Freesound search is **CC0 + 15–90s** by default (fits a 15–30s cut). Catalog skews ambient/SFX —
  good beds, not chart songs. **Platform trending audio is not pullable** (copyright).
- Short-form taste: sparse bed under VO; **no default cut whoosh** — silent cuts + ducked music
  are enough. Skip `sfx` unless a reveal/CTA earns a soft pop/click. Avoid loud drums fighting captions.
- **Place SFX after the real VO exists** (when used): `kino build` → `kino inspect --real` and/or
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
- **Expressive VO (audio tags)**: default TTS is `"voiceModel": "eleven_v3"`. Direct the read
  inline in segment text with bracketed tags — `[excited]`, `[whispers]`, `[sighs]`, `[laughs]`,
  `[curious]`, `[short pause]`. Tags are stripped from word-synced captions automatically. Use like
  emphasis: 1-2 tags per spec where the copy earns them (a hook, a reveal), not on every beat.
  **⚠ Tags only work on `eleven_v3`.** On `eleven_multilingual_v2` the model **reads them aloud**
  ("short pause", "softly", …). If the spec pins v2 for metronome-critical / speech-synced timing,
  use punctuation for pauses (`…` / `.`) and drop bracket tags entirely. Faceless only for now:
  with an avatar provider the tagged text also reaches lip-sync, untested.
- **Timing comes from the generated VO**, not your guesses — don't put timestamps in the spec.
- **Recorded VO instead of TTS**: set segment `voFile` (project audio asset) — the file is the
  beat verbatim; word timings come from STT (Scribe with the ElevenLabs key, else local
  whisper.cpp). Keep `text` matching the recording; STT normalizes tokens ("thirty"→"30"), so
  `atWord` anchors bind to the *transcribed* words (a miss fails the build listing them).
  See docs/audio.md § Imported real voiceover.
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
