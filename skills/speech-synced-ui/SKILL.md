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

Companion to `video-production`. That skill owns the trailer. **This skill owns
VO-locked typed UI** — when the caption engine is the wrong tool and a motion
graphic must paint the text instead.

Contract detail: `docs/motion-graphics.md` → *Typed-in-sync text*. Runtime surface:
`env.words` + `--kino-words-shown` / `--kino-word-count` (injected into every
`kind:"motion"` beat **and** every `motionOverlay`).

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
         + wrap in a .cam container driven by TIME (env.t / env.progress), never typed count
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

Worked example (single CSS window: chrome + burst typing + time-based camera, plus the
matching pull-back "thinking" beat, both emitted from one generator so chrome can't drift):
`projects/kino-meta/assets/motion/gen-windows.py` → `prompt-window.js` + `thinking-window.js`
(when present).

## Camera (zoom / pan)

Two different systems — don't confuse them:

| Surface | Camera | Notes |
|---|---|---|
| `app` footage (+ `frame` chrome) | `zoomKeyframes` | Scales footage **+ frame** as one group; captions/overlays stay put |
| Motion graphic (beat or overlay) | CSS `transform` on a `.cam` wrapper | **Drive off TIME** (`env.t` / `env.progress`), never the typed-character count |

### ⚠ The #1 mistake: driving the camera off the typed fraction

`charsTyped / totalChars` (or `--kino-words-shown`) is a **step function** — it jumps
each keystroke, and keystrokes aren't evenly spaced. A camera position driven by it
**lurches** once per character → visibly choppy zoom/pan. `env.t` / `env.progress`
advance smoothly at 30fps; drive the camera off those.

You cannot literally lock the camera to the caret and stay smooth — the caret is
discrete and **jumps at the line-wrap** (right edge → far-left of line 2). To "track
the text," use a continuous time proxy that follows its *general* fill direction, not
the caret itself.

```js
// inside render(env) — camera is a pure function of TIME, applied inline on .cam
var pin = Math.min(1, env.t / 0.4);            // quick punch-in over 0.4s…
var S   = 1 + 0.30 * (1 - (1 - pin) * (1 - pin));  // …easeOut, then HOLD (no per-letter creep)
var panY = -54 * (env.progress * (2 - env.progress)); // gentle pan, smooth over the whole beat
var cam = "translateY(" + panY.toFixed(2) + "px) scale(" + S.toFixed(4) + ")";
// <div class="cam" style="transform:${cam}"> …  (.cam sets transform-origin: 50% 70%)
```

Pure-CSS equivalent when no JS: `transform: scale(calc(1 + 0.3*var(--progress)))` — still
`--progress`, still smooth. A keyframed `params.cam` track gives eased holds.

### Continuous camera across beats (no "weird zoom-out" pop)

A zoomed terminal beat that hard-cuts to a wide montage beat **pops** (same window, two
scales). Make consecutive window beats share scale at their boundary:

```
beat 0 (type)   punch-in → end zoomed on field  (S≈1.30, panY≈-54)
beat 1 (think)  START at beat-0's exact end framing → PULL BACK to native (S=1.0, panY=0)
                keep the prompt in the field (don't blank it), dots think in the viewport
beat 2 (montage) native-scale PNG window → matches beat-1 END exactly → seamless
```

Because beat 1 ends at **native scale (1.0)**, it equals the PNG-framed montage window;
0→1 and 1→2 are both continuous. The only intended cut is montage → end card. A smooth
animated pull-back reads as a deliberate reveal; an instant scale change reads as a bug.

**Overlay trap:** a `motionOverlay` that zooms while the host `app`/`frame` stays static
→ text leaves the chrome. Fix: draw chrome + text as **one** motion beat and transform
that unit (this is why the window is CSS, not a PNG + overlay).

**First-beat fade trap:** default transitions fade the `app`/frame in, but overlays paint
at full opacity from frame 0 → typed text floats over blurry ground. Use `"transition":
"cut"` on that beat (or fade the overlay with the same envelope).

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
   HTML** over `assets-lib/lottie/logo-reveal.json` on a paper brand: the template's
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
- `env` has **no `duration` field**. End-of-beat / seam logic → `env.progress` thresholds
  (`> 0.95`). `progress === 1` is never true (max ≈ `(frames-1)/frames`).
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
| Window entrance | Card scale/fade or `kino-pop` in first ~20% of beat (not hard-cut full opacity unless intentional) |
| Typed text | Burst typewriter + solid caret while keys land, blink when idle |
| Ornaments | Looping Lottie dots / cursor; send-pulse on last word (`triggers`) |
| Camera | `.cam` push driven by `--progress` / `env.t` (never typed count) — whole chrome+text as one unit |
| Idle life | After prompt lands: subtle caret blink, soft ambient (dots), not a dead freeze |

If `--around` only shows text growing and nothing else moves → under-animated. Add entrance +
ornament + camera before shipping. Match brand energy (calm = soft; punchy = harder pops).

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
     → kino frames <mp4> --around <t> on EVERY speech-locked beat
     → retune KEY_MS / camera / Lottie triggers / word-gated pipelines from the sheet
     → if a step UI finishes while VO still lists steps → drive steps off env.words
6. Loop ads: prove PNG AE=0 on harness ends, then PSNR on mp4 first/last
7. Ship only after a real --around sheet shows speech-locked typing
```

Pick `--around` centers from word times (`kino inspect`): start of first word, mid-prompt,
end of last word, Lottie trigger fire. One midpoint still is **not** enough — word-block vs
burst typewriter look identical at a single frame. Camera punch-then-hold: sample
`--around` early in the beat (punch phase); a mid-beat sheet only shows the hold.

## Workflow hook

```
ad-voice (VO lines)
  → author motion .js / frame PNG / Lottie ornaments
  → omit captions on montage; typed beat uses motion only
  → still --segment → still --around (loop) → storyboard → adversarial-critique
  → kino build → inspect --real → still/frames --around → retune → ship
```

Hand back to `video-production` for music/SFX/runtime pad rules (this skill often
ships **silent bed** — user may forbid music/SFX).
