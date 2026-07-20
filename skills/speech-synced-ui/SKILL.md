---
name: speech-synced-ui
description: >
  Use when on-screen UI text must type, reveal, or animate in lockstep with
  voiceover (terminal prompts, chat inputs, spoof AI windows, code editors),
  when captions are too plain for that surface, when a motion graphic must
  zoom/pan with typed content, when building a caption-free montage or
  seamless-loop typed UI, when expanding typed content (more text, not slower
  typing), or when iterating typed/Lottie motion that needs frame-sheet QA
  (kino still --around) and real-VO retune across edit stages.
---

# Speech-synced UI (typed surfaces)

Companion to `video-production` (trailer) and `motion-design` (look / hierarchy /
anti-generic). **This skill owns VO-locked typed UI** — when the caption engine is
the wrong tool and a motion graphic must paint the text instead.

Contract detail: `docs/motion-graphics.md` → *Typed-in-sync text*. Runtime surface:
`env.words` + `--kino-words-shown` / `--kino-word-count` (injected into every
`kind:"motion"` beat **and** every `motionOverlay`).

**⚠ Time base — the silent-never-fire trap.** `env.words[i].start/end`, a motion beat's `triggers[].at`,
and its `keyframes[].at` are all **beat-local seconds** (0 = that beat's own start). But `kino inspect`
prints **absolute** timeline seconds — so a word shown as `12.5` in inspect is `12.5 − beat.startSec`
*inside* its beat. Copy an absolute inspect time straight into `triggers[].at` and it fires past the beat
end → silently never. Use **`kino retune`** (it does the offset for you) or subtract `startSec` yourself.
`env.words` arrives **already beat-local at runtime** — do *not* subtract `startSec` from it in your JS;
the offset applies only when you copy an **inspect** number into a spec `.at` field. By contrast,
spec-level `backgroundTriggers` / `backgroundKeyframes` **are** absolute-timeline — they ride the whole
video, not a beat.

## When

- Prompt / chat / terminal / code surface must **look typed**, not captioned
- Caption presets (`stroke`/`highlight`/`minimal` + word reveal) can't express the look
- Camera must push/pan **with** the typed text (same visual unit)
- Montage / product reel should show **no** caption track
- Lottie / chrome ornaments sync to speech (cursor blink, thinking dots)

**Not this skill:** ordinary lower-third captions (`video-production`); long
recording ingest (`importing-footage`); VO copy voice (`ad-voice`).

## Decision tree

```
Need on-screen spoken text?
├─ Look = brand caption style → captionMode words/phrase (video-production)
└─ Look = terminal / chat / custom chrome
   ├─ Chrome is static PNG frame + text only moves
   │  └─ app + frame + motionOverlay that reads env.words
   │     ⚠ overlay zoom ≠ frame zoom → they desync
   └─ Chrome + text must move together (push-in while typing)
      └─ ONE kind:motion graphic: draw chrome in CSS/JS + type in field
         + wrap in a .cam container driven by TIME (env.out / env.edge), never typed count
```

## Caption-free beats

`caption` is optional on every kind. Omit it → no caption node mounts.

| Brand default | Fully silent beat |
|---|---|
| `phrase` (or unset) | omit `caption` |
| `words` | `"captionMode": "phrase"` **and** omit `caption` |

`kino inspect` still prints VO word timings for authoring — that report is **not**
a caption render. Words-mode brands still paint synced spoken words unless you
override the beat to `phrase` + omit caption.

**Same trap for short lower-thirds:** under `words`, the short `caption` field does **not**
display — the spoken line does. Want `"one command"` over a busy dashboard? Force
`"captionMode": "phrase"` on that app beat.

Montage reel pattern: consecutive `app` beats, omit caption, `transition: "cut"`,
short VO nouns per beat (`"The timer."`).

## Typed text — pick a grain

| Grain | Use | How |
|---|---|---|
| **Word** | Fast, caption-like | CSS: `opacity: clamp(0, calc(var(--kino-words-shown) - i), 1)` per word |
| **Character (even)** | Steady stream inside each word | Meter `chars` across `[word.start, word.end]` with `env.t` |
| **Character (typed feel)** | Real keystrokes | Burst each word's chars at ~45ms/key over the **front** of the word span, then **hold**; idle caret blinks between words, solid while typing |

Word-block reveal (`join` all words with `start <= t`) reads as caption drip, not typing.
Prefer the burst recipe for spoof terminals / chat inputs.

**⚠ `env.words` are VO *transcript tokens*, not your display string.** In mock they're the spec `text`
split on whitespace (so `30` stays `30`), but real TTS alignment can transcribe them differently
(`30`→`thirty`, hyphen splits, dropped punctuation) — and the identical code then types the wrong
glyphs, invisible until the real build. If the on-screen string can diverge from the spoken words
(numerals, symbols, hyphenation), drive a **separate DISPLAY array** and advance it off `words[i].start`
timings; don't paint `w.word` directly. Plain lowercase phrases that match the VO verbatim can paint
`w.word`.

### Burst typewriter (Tier-2 sketch)

```js
// inside render(env) — times are beat-relative
var KEY_MS = 0.045;
var words = env.words || [];
var out = "";
var typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t < w.start) break;
  var elapsed = env.t - w.start;
  var n = Math.min(w.word.length, Math.floor(elapsed / KEY_MS) + 1);
  out += w.word.slice(0, n);
  if (i < words.length - 1) out += " ";
  typing = n < w.word.length;
}
var caretOn = typing || Math.floor(env.frame / 15) % 2 === 0;
// …paint out + caret
```

**⚠ Tier-2 string concat trap:** in multi-line `return '' + a + b` chains, never start a continuation
line with a lone `+ expr` after a line that already ended the expression — a leading `+ '<b…'` can
parse as **unary plus on a string → `NaN`**, so the field shows `pushNaN1">`. Keep one binary `+`
chain, or build with `out += …` then `return out`.

**Copyable components** (from the kino advert) in `assets-lib/motion/`:

| File | Use |
|---|---|
| `prompt-type.js` | Burst-typed prompt window + camera push |
| `json-type.js` | JSON editor typing across the VO span |
| `build-pipeline.js` | Terminal command + word-synced pipeline steps |
| `loop-ready.js` | Settle to empty ready-state (loop seam) |

Showcase: `npx tsx examples/motion-ui/render-ui.ts`. Project-local worked example:
`projects/kino-meta/assets/motion/` (+ `gen-windows.py` for shared chrome).

## Camera (zoom / pan)

Two different systems — don't confuse them:

| Surface | Camera | Notes |
|---|---|---|
| `app` footage (+ `frame` chrome) | `zoomKeyframes` | Scales footage **+ frame** as one group; captions/overlays stay put |
| Motion graphic (beat or overlay) | CSS `transform` on a `.cam` wrapper | **Drive off TIME** (`env.out` / `env.edge` / `env.t`), never the typed-character count |

### ⚠ The #1 mistake: driving the camera off the typed fraction

`charsTyped / totalChars` (or `--kino-words-shown`) is a **step function** — it jumps
each keystroke, and keystrokes aren't evenly spaced. A camera position driven by it
**lurches** once per character → visibly choppy zoom/pan. Prefer `env.out` / `env.edge`
(eased progress / seam-safe breath) over linear `env.progress`; never typed-character count.
Those advance smoothly at 30fps; drive the camera off those.

You cannot literally lock the camera to the caret and stay smooth — the caret is
discrete and **jumps at the line-wrap** (right edge → far-left of line 2). To "track
the text," use a continuous time proxy that follows its *general* fill direction, not
the caret itself.

```js
// PREFERRED for multi-beat typed reels — peaks mid-beat, native at BOTH ends
// (env.edge == sin(π·progress) → 0 at start/end → cuts don't zoom-pop; loop seam stays S=1)
var breath = env.edge;
var S = 1 + 0.06 * breath;          // keep amp small (0.04–0.08); every-beat 1.2× push feels seasick
var panY = -1.2 * breath;
var cam = "translateY(" + panY.toFixed(2) + "vw) scale(" + S.toFixed(4) + ")";
// <div class="cam" style="transform:${cam}"> …  (.cam sets transform-origin)
```

One-shot punch then hold (single hero beat only — **not** every beat in a reel):

```js
var pin = Math.min(1, env.t / 0.4);
var S = 1 + 0.12 * (1 - (1 - pin) * (1 - pin)); // local easeOut on pin, then HOLD
// whole-beat soft push: scale(1 + 0.08 * env.out)
```

Pure-CSS: `scale(calc(1 + 0.06 * var(--kino-edge)))` — prefer `--kino-edge` over raw `--progress`.

### ⚠ Don't ease-out zoom on every beat

```
BAD  beat N ends at S=1.14 + panY=-12vw  →  beat N+1 starts at S=1.0
     = whip-zoom / dive-cut (kino-meta editor→terminal felt broken this way)

GOOD every beat: S = 1 + amp·sin(π·progress)   // native at edges, soft mid breath
     settle / loop-ready: hold S=1 (no zoom-out from a prior push)
```

Hard pans (−10vw+) and roll between cuts read as camera errors, not energy. Prefer UI
motion (typing, pipeline steps, progress fill) over camera gymnastics.

### Continuous camera across beats (shared framing)

Consecutive window beats must **match scale at the cut**:

```
beat 0 (type)     breath mid → end native (S=1)
beat 1 (editor)   start native → breath mid → end native
beat 2 (terminal) start native → breath mid → end native
beat 3 (settle)   hold S=1 entire beat (ready poster = beat-0 t=0)
```

If you *do* punch hard on beat 0, beat 1 must **start at that exact end framing** and
pull back (or the cut pops). Easier: never leave native at beat edges.

**Overlay trap:** a `motionOverlay` that zooms while the host `app`/`frame` stays static
→ text leaves the chrome. Fix: draw chrome + text as **one** motion beat and transform
that unit (this is why the window is CSS, not a PNG + overlay).

**First-beat fade trap (app hosts):** default transitions fade the `app`/frame in, but
overlays paint at full opacity from frame 0. Use `"transition": "cut"` on that beat.

## Motion→motion handoffs (renderer)

Consecutive `kind:"motion"` beats **auto-dissolve** (~15 frames / 0.5s at 30fps):

1. Outgoing graphic **holds** through the VO gap (frozen at `--progress: 1`) — no flash of
   faceless backdrop between clips.
2. Incoming graphic **fades in** on top of that hold.
3. First motion beat does **not** fade in (loop seam / cold open stays opaque).
4. Last motion beat is **not** extended past VO end.

You do **not** set `"transition"` on motion (schema rejects it — that field is app-only).
Handoff is automatic when the next segment is also `motion`.

**⚠ Clear the hero before the beat ends, or the two graphics overlap.** Because the outgoing beat is
held **opaque at `--progress: 1`** while the incoming fades in over it, any hero still at full opacity at
its own beat end **collides** with the next beat's hero for the whole ~0.5s dissolve (two skulls/cans/
wordmarks on screen at once — a montage of full-frame graphics reads as "overlap near every cut"). Give
each **non-final** motion beat an **exit-fade** on its root wrapper so the held frame is an empty ground:

```css
/* fades the hero out over the last ~15% of the beat; full opacity until then */
.wrap { opacity: clamp(0, calc((1 - var(--progress)) * 7), 1); }
```

The **last** beat does **not** exit (it's the final poster / loop seam — hold it). Verify on the encoded
mp4 with `kino frames <mp4> --at <endA-0.1>,<endA>,<startB+0.1>` — the middle frame should be near-empty
ground, not two heroes.

QA the cut: `kino still --at <endA-0.05>,<startB>` — both should show full UI chrome, not
mesh/glow peeking through. After encode: watch A→B without a backdrop flash.

## Seam-safe animated grounds

Motion must paint its own `.bg` (occludes brand `mesh`/`aurora` drift). For **life** that
doesn't break `seamlessLoop`:

```js
var edge = env.edge; // 0 at beat start/end
// animate grid/orbs/scan/particles with edge * f(t) — invisible or frozen at seam frames
```

Rest state at `edge=0` must match beat-0 t=0 **and** settle end (same nebulae/grid/HUD).

## VO-locked progress UI

Bars / steppers that count **completed** steps stay at 0% for the whole active step
(e.g. bar dead during "voiceover"). Drive fill off the **spoken span** instead:

```js
// continuous across last-N noun starts → end of last word (same sched as step lights)
var barT0 = sched[0], barT1 = words[nw - 1].end + 0.2;
var barW = env.t <= barT0 ? 0
  : env.t >= barT1 ? 100
  : 100 * (env.t - barT0) / (barT1 - barT0);
```

Short words ("Voiceover,") make per-quarter 25% chunks look stuck — continuous fill doesn't.

**⚠ A single or *last* motion beat has no post-VO tail** — the beat ends exactly at the last word
(`endSec == lastWord.end`; confirm with `kino inspect`). The `+ 0.2` pad above and any reveal keyed to
`lastWord.end + pad` run **off the end** of a final beat, so the bar never reaches 100% and cards keyed
to the last word never paint. On the last/only beat, land every completion **before** the last word
ends — key reveals to *earlier* word starts, not to the tail.

## Spoof AI / chat window recipe

1. **Chrome** — prefer CSS/JS in a motion beat when typing + camera share the window.
   PNG `frame: { src, inset }` only when footage must play *inside* a hole (montage).
2. **Typed prompt** — Tier-2 `.js` reading `env.words`; omit caption on that beat.
3. **Ornaments** — Lottie `motionOverlay` for dots / cursor / send-pulse
   (transparent bg, `"loop": true` or word-fire `triggers`). **Do not** bake prompt
   glyphs into Lottie (glyph-limited, brittle).
4. **Montage** — `app` + same/similar frame PNG, caption omitted, short VO, cuts.
   Match the PNG window geometry to the CSS window (same card/viewport/field coords)
   so the CSS→PNG cut doesn't shift. Native scale on both = seamless.
5. **End card** — motion beat (HTML wordmark + CTA `texts[]`). Prefer **hand-authored
   HTML** over an adapted logo-reveal Lottie on a paper brand: its
   near-white AE wipe shapes recolor to black masks on light ground. CSS camera push OK.

**`film: 0` for paper / light windows.** kino's cinematic finish lays a vignette + grain
on `app`/photographic beats (never on motion beats), so a spoof window on paper gets a
**dark border only on the montage beats** — the mismatch you'll see at the CSS→PNG cut.
Worse: a paper brand whose `night` token is ink (e.g. `#141414`, common when ink drives
captions) is **misclassified as a dark brand** and gets the heavy vignette. Set spec-level
`"film": 0` for a clean, flat, borderless look that matches the motion beats. (Full doc:
spec-reference → `film`.)

### Frame hole geometry (when using PNG chrome)

Renderer clips framed footage at **48px** corner radius. Match the hole radius in
the PNG (≥ 48) or dark gradient leaks at the four corners. Prefer a **portrait
inset** (~9:16) when the reel is device UI / portrait stock — wide holes cover-crop
headers and slice glyph tops.

## Lottie role

| Good | Bad |
|---|---|
| Thinking dots, cursor blink, confetti burst | Baking "Kino, make me…" as Lottie text |
| Logo reveal with swapped base64 image slot | Recoloring near-white AE wipe shapes to ink on paper (masks go black) |
| Word-fire `triggers` at inspect word times | Opaque full-frame Background layer as overlay |

## Lint / authoring gotchas

- Tier-2 JS lint blanks **comments and string/template literal contents** before scanning —
  `"prompt-window.js"` / `` `file: prompt-window.js` `` / `// see window.location` are fine.
  Expressions inside `${…}` are still scanned — `` `${window.location}` `` is banned.
- Don't put `window.` / `document.` / `globalThis.` in live code (banned).
- Motion HTML `body { background }` often doesn't paint (container host) — use an
  explicit full-bleed paper/night `div` as the first layer. For **seamless loops**, that layer
  must be **static** (no brand mesh/aurora behind — those drift on the global frame; see
  `video-production` § Seamless loops).
- End-of-beat / seam logic → `env.progress` / `env.edge` thresholds (`progress > 0.95`).
  `progress === 1` is never true (max ≈ `(frames-1)/frames`). Prefer progress/edge over
  `env.duration` so mock vs real VO length stays stable.
- Short locals collide easily in one-file procs (`st`, `t`, `i`) — don't shadow loop vars when
  adding schedule helpers (silent logic bugs that only show on `--around` sheets).
- After TS/render changes: rebuild `dist` — CLI runs compiled output.

## More text ≠ slower typing

User wants a longer / denser typed block → **expand the string / `LINES` array** (more JSON keys,
more pipeline detail). Do **not** stretch the beat with a longer VO or switch to
`frac = env.progress` over a padded beat unless they ask for slower typing. Same KEY_MS /
word-meter, more glyphs. Confirm with a harness `--around` before the full rebuild.

## Animate the surface (not just the letters)

Typing alone is one layer. Spoof windows / terminals should still feel alive:

| Layer | Do |
|---|---|
| Window entrance | Card scale/fade or `kino-pop` in first ~20% of beat. **First/only beat (cold open / loop seam): scale-only, keep `opacity:1`** — an opacity fade from 0 blanks the `--at 0` poster |
| Typed text | Burst typewriter + solid caret while keys land, blink when idle |
| Ornaments | Looping Lottie dots / cursor; send-pulse on last word (`triggers`) |
| Camera | Soft mid-beat breath (`sin(π·progress)`), **native at beat edges** — whole chrome+text as one unit |
| Idle life | After prompt lands: subtle caret blink, soft ambient (dots), not a dead freeze |
| Beat handoff | Trust renderer motion→motion dissolve; don't invent a second fade in the graphic |

If `--around` only shows text growing and nothing else moves → under-animated. Add entrance +
ornament + light camera breath before shipping. Match brand energy (calm = soft breath;
punchy = UI pops / pulses, not a 1.25× zoom every cut).

## Visual loop (mandatory — typed UI + Lottie ornaments)

Do **not** author from `inspect` alone. Motion that "types" or "blinks" only proves itself in
pixels across time. Use `kino still` / `--around` at **every** stage (mock is free). Prefer
**per-beat harness specs** so you aren't waiting on a full Remotion encode each tweak.

```
1. Scaffold chrome / proc / Lottie
     → kino still --segment N          # layout, field box, opaque bg?
     → kino still --at 0               # ready poster / empty field (NOT midpoint)
2. Wire env.words / caret / camera
     → kino still --around <mid>       # chars stream? caret? cam moves?
     → Read the sheet; edit; repeat (this is the main loop)
3. Dense typing / short words
     → --around <t> --span 0.5 --count 7
4. Whole cut
     → kino storyboard + adversarial-critique
     (attach --around sheets for typed + Lottie beats — not only sb-*.png)
5. Real VO
     → kino build → inspect --real
     → kino retune <spec>              # rewrite triggers[].at from word timings
     → kino frames <mp4> --around <t> on EVERY speech-locked beat
     → retune KEY_MS / camera / word-gated pipelines from the sheet
     → if a step UI finishes while VO still lists steps → drive steps off env.words
6. Loop ads: `"seamlessLoop": true` + `"film": 0`; prove PNG AE=0 on harness ends
   (`still --at 0` vs settle end); post-build seam warn + AV hold (no black EOF)
7. Ship only after a real --around sheet shows speech-locked typing
```

Pick `--around` centers from word times (`kino inspect`): start of first word, mid-prompt,
end of last word, Lottie trigger fire. One midpoint still is **not** enough — word-block vs
burst typewriter look identical at a single frame. Also sample **beat boundaries**
(`endA` / `startB`) to confirm the dissolve — not a backdrop flash or zoom pop.

## Workflow hook

```
ad-voice (VO lines)
  → author motion .js / frame PNG / Lottie ornaments
  → omit captions on montage; typed beat uses motion only
  → still --segment → still --around (loop) → storyboard → adversarial-critique
  → kino build → inspect --real → kino retune → still/frames --around → retune knobs → ship
```

Hand back to `video-production` for music/SFX/runtime pad rules (this skill often
ships **silent bed** — user may forbid music/SFX).
