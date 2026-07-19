# kino advert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a ~22s, 9:16, seamlessly-looping advert for kino — a spoof kino AI window types "Kino, make me an advert" in sync with the VO, then reveals the real flow (agent writes a spec → `kino build` → this video), and loops back into the prompt being typed.

**Architecture:** Faceless kino spec (`provider: none`), six `kind:"motion"` beats, **no captions** — every on-screen word is a motion graphic locked to the VO via `env.words` (burst-typewriter). A shared Python generator emits the three window states so chrome never drifts; the first frame and last frame are the identical empty-prompt window so the mp4 loops invisibly.

**Tech Stack:** kino CLI (TypeScript/Remotion), ElevenLabs VO (`eleven_multilingual_v2`), Tier-2 motion `.js` (`render(env) → HTML string`), Freesound CC0 music. Design spec: [docs/superpowers/specs/2026-07-19-kino-advert-design.md](../specs/2026-07-19-kino-advert-design.md).

## Global Constraints

Every task's requirements implicitly include this section.

- **Palette (verbatim):** night `#0b1020`, mint `#80e2b4`, green `#0c8d64`, gold `#d99a20`, white `#ffffff`. Use CSS vars in motion graphics (`--kino-night`, `--kino-mint`, `--kino-green`, `--kino-gold`, `--kino-white`).
- **No captions:** every beat **omits `caption`**. All text is painted by the motion graphics. Do not set a words-mode caption on any beat.
- **`provider: "none"`** (faceless), **`film: 0`** (spec level), **`voiceModel: "eleven_multilingual_v2"`** (typed sync needs metronome-stable timing).
- **Loop is a hard constraint:** beat-0 frame 0 ≡ beat-5 final frame = the settled empty prompt-window (empty input, `kino ●` wordmark, caret **solid**, native scale). No window entrance pop on beat 0. **Static grain/vignette only** (frame-independent). Caret forced solid for the first ~5 and last ~5 frames.
- **Motion determinism lint (build rejects these):** no `<script>`, no `on*=`, no CSS `transition`, no `animation-play-state`, no SVG SMIL, no `requestAnimationFrame`/`setInterval`/`setTimeout`, no `Date.now`/`Math.random`, no `fetch`/`XMLHttpRequest`, no `url()` except `data:`/`#fragment`, no `@import`. Tier-2 `.js` additionally bans `import`/`require`/`process`/direct `document`/`window`/`globalThis`. Comments are stripped before the scan.
- **Camera** on motion beats is a CSS `transform` on a `.cam` wrapper driven by `env.t`/`--progress` — **never** the typed-character count (it lurches). Burst typewriter `KEY_MS ≈ 0.045`.
- **Units:** size in `vw` (1vw = 10.8px on the 1080-wide canvas). Stacks mid-frame.
- **CLI runs `dist/`, not `src/`.** After any TypeScript change, `npm run build`. The `env.words` feature is uncommitted WIP on this branch — Task 0 builds it first.
- **Commits:** this work sits on top of uncommitted `feat/motion-word-timings` WIP. **Scope every `git add` to explicit ad paths — never `git add -A`** — so ad assets don't entangle the WIP. Coordinate the final merge with the maintainer.
- **Renderer bug vs spec mistake:** if a render bug is suspected (not a spec error), STOP and report before editing `src/render/**` (shared across all brands) — per the `video-production` hard rule.

---

## File structure

| File | Responsibility |
|---|---|
| `brands/kino/brand.md` | kino brand: palette, fonts, voice, `voiceModel`, `film:0`, Tone/Voice |
| `projects/kino-meta/project.json` | binds the project to brand `kino` |
| `projects/kino-meta/assets/gen/*.png` | the 4 approved concept frames (reference) |
| `projects/kino-meta/assets/motion/gen-windows.py` | generator → emits the 3 window `.js` (shared chrome) |
| `projects/kino-meta/assets/motion/prompt-window.js` | beat 0 — typing prompt + camera push |
| `projects/kino-meta/assets/motion/thinking-window.js` | beat 1 — pull-back + thinking dots |
| `projects/kino-meta/assets/motion/close-window.js` | beat 5 — CTA lockup → settle to ready-state ≡ Frame 0 |
| `projects/kino-meta/assets/motion/spec-editor.js` | beat 2 — schema keys typing |
| `projects/kino-meta/assets/motion/build-terminal.js` | beat 3 — `kino build` + pipeline |
| `projects/kino-meta/assets/motion/range-tiles.js` | beat 4 — capability triptych |
| `projects/kino-meta/specs/advert.json` | the 6-beat spec |
| `projects/kino-meta/out/advert/…mp4` | final deliverable |

**Verification model (this is a video, not a library).** Each beat's "test" is: run `kino still … --around <t>`, **Read the sheet image**, and confirm the listed observations. A beat you have only seen as one `--segment` still or storyboard midpoint is **not done** (`video-production` hard rule). "Fails" = the sheet doesn't show the expected motion; tune and re-shoot.

---

### Task 0: Build the linchpin + smoke-test `env.words`

**Files:**
- Modify: none (compile existing WIP)
- Create (throwaway): `projects/kino-meta/assets/motion/_smoke.js`, `projects/kino-meta/specs/_smoke.json`

**Interfaces:**
- Produces: a verified `dist/` where a Tier-2 motion `.js` receives `env.words` as `{word,start,end}[]` (beat-relative seconds) and `--kino-words-shown`/`--kino-word-count` CSS vars are set per frame.

- [ ] **Step 1: Build dist**

Run: `cd ~/Developer/Kino/kino && npm run build`
Expected: completes with no TypeScript errors; `dist/` updated.

- [ ] **Step 2: Write a throwaway smoke motion graphic**

Create `projects/kino-meta/assets/motion/_smoke.js`:

```js
var KEY = 0.045, words = env.words || [], out = "", typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t < w.start) break;
  var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
  out += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
  typing = n < w.word.length;
}
var caretOn = typing || Math.floor(env.frame / 15) % 2 === 0;
return '<div style="position:absolute;inset:0;background:#0b1020;display:flex;' +
  'align-items:center;justify-content:center;font-family:var(--kino-font);' +
  'color:#fff;font-size:6vw">' + out +
  '<b style="color:#80e2b4;opacity:' + (caretOn ? 1 : 0) + '">█</b>' +
  '<div style="position:absolute;bottom:4vw;color:#80e2b4;font-size:3vw">' +
  'shown ' + Math.round((words.filter(function(x){return env.t>=x.start}).length)) +
  '/' + words.length + '</div></div>';
```

- [ ] **Step 3: Write a throwaway spec that gives the beat spoken words**

Create `projects/kino-meta/specs/_smoke.json`:

```json
{ "title": "smoke", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/_smoke.js",
    "text": "Kino make me an advert right now" } ] }
```

- [ ] **Step 4: Shoot an `--around` sheet across the typing**

Run: `kino still projects/kino-meta/specs/_smoke.json --around 1.2 --span 1.2 --count 6`
Expected: a sheet PNG path is printed. **Read it.**
PASS = across the 6 tiles the sentence types **progressively** (tile 1 = a few chars, last tile = full/near-full line), the mint caret is visible, and the `shown N/total` counter climbs. FAIL = all tiles identical / empty / counter stuck at 0 → `env.words` is not reaching the graphic; stop and diagnose (confirm Step 1 built, confirm the beat has `text`).

- [ ] **Step 5: Delete the smoke files**

Run: `rm projects/kino-meta/assets/motion/_smoke.js projects/kino-meta/specs/_smoke.json`

- [ ] **Step 6: No commit** (dist is build output; smoke files deleted). Record in the task log that `env.words` is verified live.

---

### Task 1: kino brand + project scaffold

**Files:**
- Create: `brands/kino/brand.md`
- Create: `projects/kino-meta/project.json`
- Create: `projects/kino-meta/assets/gen/{01-hero-window,02-spec-editor,03-build-terminal,04-cta-endcard}.png` (copied)

**Interfaces:**
- Produces: brand `kino` (readable via `kino brand kino`) and project `kino-meta` so specs under it inherit the brand.

- [ ] **Step 1: Confirm a mono font id for `labelFont`**

Run: `kino fonts | grep -iE "mono|jetbrains|geist|ibm|space"`
Expected: a printed list. Pick a mono id (e.g. `JetBrains Mono`) and a clean display sans for `font` (e.g. `Inter`). Use whatever the list actually offers.

- [ ] **Step 2: Write `brands/kino/brand.md`**

Create `brands/kino/brand.md` (replace `<sans>`/`<mono>` with Step-1 picks; write the Tone/Voice body per the `ad-voice` skill — read it first):

```markdown
---
name: kino
font: "<sans>"
labelFont: "<mono>"
defaultProvider: none
defaultVoice: "21m00Tcm4TlvDq8ikWAM"
voiceModel: eleven_multilingual_v2
film: 0
background: mesh
colors:
  night: "#0b1020"
  mint: "#80e2b4"
  green: "#0c8d64"
  white: "#ffffff"
  gold: "#d99a20"
logo: assets/gen/04-cta-endcard.png
---

# kino

Agent-driven short-form video production. An agent authors a JSON spec; kino
renders it deterministically — ElevenLabs VO, optional avatar or a faceless
background, composited in Remotion to a 9:16 MP4.

## Tone / Voice

<Written via the ad-voice skill. Direction: calm, confident, cinematic — a
narrator who trusts the product. Short declaratives. The differentiator is
honesty: no "AI magic" hype; the reveal is that a real agent writes a real
spec and one command builds it. Avoid slop ("unleash", "revolutionize",
"effortless", "game-changer"). Never open on the brand name.>
```

- [ ] **Step 3: Scaffold the project**

Run: `kino projects --new kino-meta --brand kino`
Expected: creates `projects/kino-meta/{specs,assets,out}` + `project.json` referencing brand `kino`. If the command reports the dir exists, that's fine — verify `project.json` names the brand.

- [ ] **Step 4: Copy the approved concept frames in**

Run:
```bash
mkdir -p projects/kino-meta/assets/gen
cp scratchpad/concepts/*.png projects/kino-meta/assets/gen/
```
Expected: 4 PNGs present in `assets/gen/`.

- [ ] **Step 5: Verify the brand reads**

Run: `kino brand kino`
Expected: prints kino's palette (the 5 hexes above), font/labelFont, voice, `film 0`. No error.

- [ ] **Step 6: Commit (scoped)**

```bash
git add brands/kino/brand.md projects/kino-meta/project.json projects/kino-meta/assets/gen
git commit -m "feat(kino-meta): add kino brand + project scaffold for the advert"
```

---

### Task 2: `gen-windows.py` + `prompt-window.js` (beat 0)

**Files:**
- Create: `projects/kino-meta/assets/motion/gen-windows.py`
- Generate: `projects/kino-meta/assets/motion/prompt-window.js`, `thinking-window.js`, `close-window.js`
- Create (temp harness spec): reuse `advert.json` later; here shoot beat 0 in isolation via a one-beat spec `projects/kino-meta/specs/_b0.json`

**Interfaces:**
- Produces: three Tier-2 `.js` files whose **window chrome is byte-identical** (same shared `WIN()` JS helper). `prompt-window.js` types `env.words` with the burst recipe and pushes the camera in off `env.t`; at `t=0` it renders the **settled empty window at native scale** (the loop poster frame). `close-window.js` converges at `progress→1` to that **same** poster markup.

- [ ] **Step 1: Write the generator**

Create `projects/kino-meta/assets/motion/gen-windows.py`. It writes three `render(env)` bodies that all call one shared `WIN(...)` chrome helper, so geometry can't drift. (The Python only concatenates strings — the emitted JS is what kino lints.)

```python
#!/usr/bin/env python3
"""Emit the three kino-window motion graphics from one shared chrome definition."""
import pathlib

HERE = pathlib.Path(__file__).parent

# Shared JS prelude: WIN(fieldHtml, caretOn, camStyle, ctaHtml) -> full window HTML.
# Static grain/vignette (frame-independent) => loop-safe. No banned tokens.
SHARED = r"""
function WIN(fieldHtml, caretOn, camStyle, ctaHtml) {
  var caret = '<b class="crt" style="opacity:' + (caretOn ? 1 : 0) + '">█</b>';
  return ''
  + '<div class="cam" style="transform:' + camStyle + '">'
  +   '<div class="win">'
  +     '<div class="bar"><span class="mark">kino</span><span class="dot"></span></div>'
  +     (ctaHtml || '')
  +     '<div class="field"><span class="txt">' + fieldHtml + caret + '</span>'
  +       '<span class="send">↑</span></div>'
  +   '</div>'
  + '</div>'
  + '<div class="kino-grain"></div><div class="kino-vignette"></div>'
  + '<style>'
  + '.cam{position:absolute;inset:0;transform-origin:50% 62%}'
  + '.win{position:absolute;left:9%;right:9%;top:24%;bottom:24%;border-radius:3vw;'
  +   'background:rgba(9,14,28,.72);border:0.18vw solid var(--kino-mint);'
  +   'box-shadow:0 0 6vw rgba(128,226,180,.28), inset 0 0 4vw rgba(128,226,180,.06)}'
  + '.bar{position:absolute;left:5%;top:5%;display:flex;align-items:center;gap:1vw}'
  + '.mark{font-family:var(--kino-font);color:var(--kino-white);font-weight:800;font-size:3.4vw}'
  + '.dot{width:1.1vw;height:1.1vw;border-radius:50%;background:var(--kino-gold)}'
  + '.field{position:absolute;left:6%;right:6%;bottom:8%;height:8vw;border-radius:2vw;'
  +   'background:rgba(128,226,180,.06);border:0.12vw solid rgba(128,226,180,.35);'
  +   'display:flex;align-items:center;padding:0 3vw}'
  + '.txt{font-family:var(--kino-label-font);color:var(--kino-white);font-size:3.4vw;'
  +   'white-space:pre;flex:1}'
  + '.crt{color:var(--kino-mint);margin-left:.3vw}'
  + '.send{width:5vw;height:5vw;border-radius:50%;background:rgba(128,226,180,.12);'
  +   'color:var(--kino-mint);display:flex;align-items:center;justify-content:center;font-size:3vw}'
  + '</style>';
}
"""

# --- beat 0: type env.words, camera push-in; settled window at t=0 (no pop) ---
PROMPT = SHARED + r"""
var KEY = 0.045, words = env.words || [], out = "", typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t < w.start) break;
  var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
  out += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
  typing = n < w.word.length;
}
// caret: solid while typing; solid for the first 5 frames (loop seam); else blink
var caretOn = typing || env.frame < 5 || Math.floor(env.frame / 15) % 2 === 0;
// camera: native at t=0, quick punch-in over 0.4s then HOLD (off TIME, not typed count)
var pin = Math.min(1, env.t / 0.4);
var S = 1 + 0.14 * (1 - (1 - pin) * (1 - pin));
var cam = "scale(" + S.toFixed(4) + ")";
return WIN(out, caretOn, cam, "");
"""

# --- beat 1: prompt already there; PULL BACK to native; thinking dots pulse ---
THINKING = SHARED + r"""
var full = "Kino, make me an advert";
// start zoomed (match beat-0 end S=1.14), pull back to native across the beat
var S = 1.14 - 0.14 * (env.progress * (2 - env.progress));
var cam = "scale(" + S.toFixed(4) + ")";
// three thinking dots pulsing off --t (continuous life), offset per dot
function dot(k){
  var a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(env.t * 6 - k));
  return '<span style="width:1.4vw;height:1.4vw;border-radius:50%;background:var(--kino-mint);'
    + 'display:inline-block;margin:0 .6vw;opacity:' + a.toFixed(3) + '"></span>';
}
var dots = '<div style="margin-left:.6vw;display:inline-flex;align-items:center">'
  + dot(0) + dot(1) + dot(2) + '</div>';
var caretOn = false; // dots carry the life here
return WIN(full + '', caretOn, cam, '') .replace('<span class="send">', dots + '<span class="send">');
"""

# --- beat 5: CTA lockup, then settle to the EMPTY ready-state == beat-0 frame 0 ---
CLOSE = SHARED + r"""
// first ~70% shows the CTA lockup fading in; last ~30% clears to the empty ready-state
var fade = Math.min(1, env.progress / 0.6);            // lockup in
var clear = Math.max(0, (env.progress - 0.7) / 0.3);   // lockup out + field empties
var showFull = clear < 1;
var field = showFull ? "Kino, make me an advert" : "";
// caret solid for the last 5 frames (loop seam)
var total = env.duration ? Math.round(env.duration * 30) : 0;
var caretOn = (total && env.frame > total - 6) || Math.floor(env.frame / 15) % 2 === 0;
var camS = 1.0; // native scale at the seam
var cta = '<div class="cta" style="opacity:' + (fade * (1 - clear)).toFixed(3) + '">'
  + '<div class="wm">kino</div>'
  + '<div class="pill">tell your agent</div></div>'
  + '<style>.cta{position:absolute;left:0;right:0;top:34%;text-align:center}'
  + '.wm{font-family:var(--kino-font);color:var(--kino-white);font-weight:800;font-size:9vw;'
  +   'text-shadow:0 0 5vw rgba(128,226,180,.5),0 0 8vw rgba(217,154,32,.35)}'
  + '.pill{display:inline-block;margin-top:2vw;padding:1.4vw 3.2vw;border-radius:5vw;'
  +   'background:var(--kino-gold);color:#0b1020;font-family:var(--kino-label-font);font-size:2.6vw}'
  + '</style>';
// when cleared, drop the CTA entirely so the final frame == empty prompt window
return WIN(field, caretOn, "scale(" + camS.toFixed(3) + ")", showFull ? cta : "");
"""

for name, body in [("prompt-window.js", PROMPT),
                   ("thinking-window.js", THINKING),
                   ("close-window.js", CLOSE)]:
    (HERE / name).write_text(body.strip() + "\n")
    print("wrote", name)
```

> Note: `env.duration` may not be provided; if `close-window.js` errors on it, replace the `total`
> line with a fixed `var total = 120;` (4s * 30fps) — Task 7 verifies and adjusts.

- [ ] **Step 2: Generate the three files**

Run: `python3 projects/kino-meta/assets/motion/gen-windows.py`
Expected: prints `wrote prompt-window.js` / `thinking-window.js` / `close-window.js`.

- [ ] **Step 3: One-beat harness spec for beat 0**

Create `projects/kino-meta/specs/_b0.json`:

```json
{ "brand": "kino", "title": "_b0", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/prompt-window.js",
    "text": "Kino, make me an advert", "transition": "cut" } ] }
```

- [ ] **Step 4: Layout still at t=0 (the loop poster frame)**

Run: `kino still projects/kino-meta/specs/_b0.json --segment 0`
Expected path printed. **Read it.** PASS = the window is fully settled (no half-scale/half-opacity), `kino ●` wordmark top-left, empty-ish field with a mint caret, send arrow, mint glow border, grain+vignette. This frame is the loop target — it must look finished, not mid-entrance.

- [ ] **Step 5: `--around` sheet across the typing**

Run: `kino still projects/kino-meta/specs/_b0.json --around 1.4 --span 1.6 --count 6`
**Read it.** PASS = prompt types progressively across tiles (burst feel, not all-at-once), caret solid while typing, and the window **scales up slightly** from tile 1→last (camera push). FAIL = text appears in one jump (word-block) → confirm KEY loop; camera doesn't move → confirm `.cam` transform.

- [ ] **Step 6: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/gen-windows.py \
        projects/kino-meta/assets/motion/prompt-window.js \
        projects/kino-meta/assets/motion/thinking-window.js \
        projects/kino-meta/assets/motion/close-window.js \
        projects/kino-meta/specs/_b0.json
git commit -m "feat(kino-meta): window generator + beat-0 prompt typing"
```

---

### Task 3: beat 1 — thinking / camera pull-back (`thinking-window.js`)

**Files:**
- Modify (via generator): `thinking-window.js`
- Create: `projects/kino-meta/specs/_b1.json`

**Interfaces:**
- Consumes: `WIN(...)` chrome from Task 2. Produces beat 1 that **starts at beat-0's end scale (~1.14) and pulls back to native (1.0)** so the later cut to the editor doesn't pop, with pulsing thinking dots for continuous life.

- [ ] **Step 1: One-beat harness**

Create `projects/kino-meta/specs/_b1.json`:

```json
{ "brand": "kino", "title": "_b1", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/thinking-window.js",
    "text": "There's no magic here", "transition": "cut" } ] }
```

- [ ] **Step 2: `--around` sheet across the beat**

Run: `kino still projects/kino-meta/specs/_b1.json --around 1.0 --span 1.6 --count 6`
**Read it.** PASS = the window **shrinks slightly** tile 1→last (pull-back to native), the prompt text stays visible in the field, and the three dots change brightness across tiles (pulsing). FAIL = static scale → check the `S` easing; dots identical across tiles → check the `sin(env.t*…)` phase.

- [ ] **Step 3: Verify scale continuity with beat 0**

Compare the **last** tile of Task 2 Step 5 (S≈1.14) with the **first** tile here (should also be ≈1.14). PASS = visually the same zoom. If not, align the constants (beat-0 end S and beat-1 start S must match).

- [ ] **Step 4: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/thinking-window.js projects/kino-meta/specs/_b1.json
git commit -m "feat(kino-meta): beat-1 thinking pull-back"
```

---

### Task 4: beat 2 — spec editor (`spec-editor.js`)

**Files:**
- Create: `projects/kino-meta/assets/motion/spec-editor.js`
- Create: `projects/kino-meta/specs/_b2.json`

**Interfaces:**
- Consumes: `env.words`. Produces beat 2: a dark editor that types **kino's real schema keys** in sync with the VO, with a soft downward pan. Uses the same burst-typewriter clock as the windows.

- [ ] **Step 1: Write `spec-editor.js`**

Create `projects/kino-meta/assets/motion/spec-editor.js`:

```js
// A stylised editor. The typed lines are REAL kino schema keys (honest).
// env.words drives how far through the spec we've typed (burst feel via char meter).
var LINES = [
  '{',
  '  "brand": "kino",',
  '  "provider": "none",',
  '  "segments": [',
  '    { "kind": "motion", "source": "prompt-window.js",',
  '      "text": "Kino, make me an advert" }',
  '  ]',
  '}'
];
var full = LINES.join("\n");
var words = env.words || [];
// fraction of the spec revealed = fraction of spoken words started, metered smooth by --t
var wStarted = 0, i;
for (i = 0; i < words.length; i++) { if (env.t >= words[i].start) wStarted++; }
var frac = words.length ? (wStarted + Math.min(1, (env.t - (words[Math.max(0,wStarted-1)]||{start:0}).start) / 0.25)) / words.length : env.progress;
frac = Math.max(0, Math.min(1, frac));
var shown = full.slice(0, Math.floor(full.length * frac));
var caretOn = frac < 1 || Math.floor(env.frame / 15) % 2 === 0;
// gutter line numbers for however many lines are visible
var vis = shown.split("\n");
var gutter = "";
for (i = 0; i < vis.length; i++) gutter += (i + 1) + "\n";
// gentle downward pan as more lines fill
var panY = -6 * env.progress; // vw
return ''
+ '<div class="cam" style="transform:translateY(' + panY.toFixed(2) + 'vw)">'
+   '<div class="ed">'
+     '<div class="top"><span class="d r"></span><span class="d y"></span><span class="d g"></span>'
+       '<span class="fn">advert.json</span></div>'
+     '<div class="body"><pre class="gut">' + gutter + '</pre>'
+       '<pre class="code">' + esc(shown) + '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></pre></div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.cam{position:absolute;inset:0;transform-origin:50% 40%}'
+ '.ed{position:absolute;left:6%;right:6%;top:16%;bottom:16%;border-radius:2.5vw;'
+   'background:rgba(9,14,28,.85);border:0.12vw solid rgba(128,226,180,.25);overflow:hidden}'
+ '.top{height:7vw;display:flex;align-items:center;gap:1vw;padding:0 3vw;'
+   'background:rgba(128,226,180,.05)}'
+ '.d{width:1.4vw;height:1.4vw;border-radius:50%}.r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}'
+ '.fn{margin-left:2vw;font-family:var(--kino-label-font);color:rgba(255,255,255,.6);font-size:2.4vw}'
+ '.body{display:flex;padding:3vw}'
+ '.gut{margin:0;color:rgba(128,226,180,.4);font-family:var(--kino-label-font);font-size:3vw;'
+   'line-height:4.6vw;text-align:right;padding-right:2vw}'
+ '.code{margin:0;color:var(--kino-white);font-family:var(--kino-label-font);font-size:3vw;'
+   'line-height:4.6vw;white-space:pre}'
+ '.crt{color:var(--kino-mint)}'
+ '</style>';

function esc(s){ return s.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;"); }
```

- [ ] **Step 2: One-beat harness**

Create `projects/kino-meta/specs/_b2.json`:

```json
{ "brand": "kino", "title": "_b2", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/spec-editor.js",
    "text": "Your agent writes a spec", "transition": "cut" } ] }
```

- [ ] **Step 3: Layout + progression sheets**

Run: `kino still projects/kino-meta/specs/_b2.json --segment 0`
**Read it.** PASS = editor chrome (traffic-light dots, `advert.json` filename, line-number gutter, monospace), clear of frame edges.

Run: `kino still projects/kino-meta/specs/_b2.json --around 1.2 --span 1.6 --count 6`
**Read it.** PASS = the JSON types on progressively (more lines each tile), caret visible, subtle downward pan. FAIL = whole block present on tile 1 → check `frac`; text overflows the card → reduce font-size `vw` or trim `LINES`.

- [ ] **Step 4: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/spec-editor.js projects/kino-meta/specs/_b2.json
git commit -m "feat(kino-meta): beat-2 spec editor typing"
```

---

### Task 5: beat 3 — build terminal (`build-terminal.js`)

**Files:**
- Create: `projects/kino-meta/assets/motion/build-terminal.js`
- Create: `projects/kino-meta/specs/_b3.json`

**Interfaces:**
- Consumes: `env.words`, `env.pulse`. Produces beat 3: `> kino build advert.json` types on, then a 4-step vertical pipeline (`voiceover / compose / render / mp4`) illuminates top→down; each step pops via `--pulse` fired by spec `triggers` on the spoken step words.

- [ ] **Step 1: Write `build-terminal.js`**

Create `projects/kino-meta/assets/motion/build-terminal.js`:

```js
var CMD = "kino build advert.json";
var KEY = 0.05;
// type the command over the first ~1s off --t (independent of VO words here)
var n = Math.min(CMD.length, Math.floor(env.t / KEY));
var typed = CMD.slice(0, n);
var cmdDone = n >= CMD.length;
var caretOn = !cmdDone || Math.floor(env.frame / 15) % 2 === 0;
// pipeline steps light up on a schedule after the command finishes typing (~1.1s)
var steps = ["voiceover", "compose", "render", "mp4"];
var t0 = 1.1, per = 0.45;
function state(k){
  var s = t0 + k * per;                 // when this step activates
  if (env.t < s) return 0;              // pending
  if (env.t < s + per) return 1;        // active (glowing)
  return 2;                             // done (checked)
}
var rows = "";
for (var k = 0; k < steps.length; k++){
  var st = state(k);
  var col = st === 2 ? "var(--kino-mint)" : st === 1 ? "var(--kino-gold)" : "rgba(255,255,255,.25)";
  var glow = st === 1 ? "0 0 3vw " + col : "none";
  var mark = st === 2 ? "✓" : st === 1 ? "●" : "○";
  // pulse the active row with the trigger envelope
  var pop = 1 + 0.12 * (st === 1 ? env.pulse : 0);
  rows += '<div class="row" style="transform:scale(' + pop.toFixed(3) + ')">'
    + '<span class="ic" style="color:' + col + ';box-shadow:' + glow + '">' + mark + '</span>'
    + '<span class="lbl" style="color:' + (st ? "var(--kino-white)" : "rgba(255,255,255,.4)") + '">'
    + steps[k] + '</span></div>';
}
return ''
+ '<div class="term">'
+   '<div class="cmd"><span class="pr">›</span> ' + typed
+     + '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></div>'
+   '<div class="pipe">' + rows + '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.term{position:absolute;left:7%;right:7%;top:18%;bottom:18%;border-radius:2.5vw;'
+   'background:rgba(6,10,22,.9);border:0.12vw solid rgba(128,226,180,.2);padding:5vw}'
+ '.cmd{font-family:var(--kino-label-font);color:var(--kino-white);font-size:4vw}'
+ '.pr{color:var(--kino-mint)}.crt{color:var(--kino-mint)}'
+ '.pipe{margin-top:6vw;display:flex;flex-direction:column;gap:4vw;align-items:center}'
+ '.row{display:flex;align-items:center;gap:2.5vw;min-width:44vw}'
+ '.ic{width:6vw;height:6vw;border-radius:50%;border:0.2vw solid currentColor;'
+   'display:flex;align-items:center;justify-content:center;font-size:3vw}'
+ '.lbl{font-family:var(--kino-font);font-size:4vw}'
+ '</style>';
```

- [ ] **Step 2: One-beat harness with pulse triggers**

Create `projects/kino-meta/specs/_b3.json` (trigger `at` times are mock estimates on the words "Voiceover, motion, render"; Task 10 retunes to real times):

```json
{ "brand": "kino", "title": "_b3", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/build-terminal.js",
    "text": "one command builds it. Voiceover, motion, render.",
    "transition": "cut",
    "triggers": [ { "at": 1.3, "action": "pulse" }, { "at": 1.75, "action": "pulse" },
                  { "at": 2.2, "action": "pulse" } ] } ] }
```

- [ ] **Step 3: Progression sheet**

Run: `kino still projects/kino-meta/specs/_b3.json --around 1.6 --span 2.0 --count 7`
**Read it.** PASS = command types on early tiles; then pipeline rows switch pending→active(gold)→done(mint check) top→down across tiles; the active row shows a glow/scale pop. FAIL = all rows same state → check `state(k)` timing vs beat length; no pop → check `env.pulse`/triggers.

- [ ] **Step 4: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/build-terminal.js projects/kino-meta/specs/_b3.json
git commit -m "feat(kino-meta): beat-3 build terminal + pipeline"
```

---

### Task 6: beat 4 — range tiles (`range-tiles.js`)

**Files:**
- Create: `projects/kino-meta/assets/motion/range-tiles.js`
- Create: `projects/kino-meta/specs/_b4.json`

**Interfaces:**
- Produces beat 4: three capability tiles (caption / motion-counter / framed-phone) that **stagger in** via offset `--progress` slices, representing what kino outputs.

- [ ] **Step 1: Write `range-tiles.js`**

Create `projects/kino-meta/assets/motion/range-tiles.js`:

```js
// three tiles ignite in sequence (staggered off --progress), each a kino capability
var tiles = [
  { label: "captions", body: '<div class="capline">the timer.</div>' },
  { label: "motion", body: '<div class="num">86%</div>' },
  { label: "footage", body: '<div class="phone"></div>' }
];
var html = "";
for (var i = 0; i < tiles.length; i++){
  var start = 0.1 + i * 0.18;                       // stagger
  var a = Math.max(0, Math.min(1, (env.progress - start) * 6));
  var y = (1 - a) * 6;                              // rise vw
  html += '<div class="tile" style="opacity:' + a.toFixed(3)
    + ';transform:translateY(' + y.toFixed(2) + 'vw) scale(' + (0.96 + 0.04*a).toFixed(3) + ')">'
    + '<div class="inner">' + tiles[i].body + '</div>'
    + '<div class="cap">' + tiles[i].label + '</div></div>';
}
return '<div class="wrap">' + html + '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.wrap{position:absolute;left:8%;right:8%;top:30%;display:flex;flex-direction:column;gap:3vw}'
+ '.tile{border-radius:2.5vw;background:rgba(9,14,28,.8);border:0.12vw solid rgba(128,226,180,.25);'
+   'height:16vw;display:flex;align-items:center;justify-content:space-between;padding:0 4vw}'
+ '.inner{flex:1;display:flex;align-items:center;justify-content:center;height:100%}'
+ '.cap{font-family:var(--kino-label-font);color:rgba(128,226,180,.7);font-size:2.6vw}'
+ '.capline{font-family:var(--kino-font);color:#fff;font-size:5vw;'
+   'background:rgba(11,16,32,.9);padding:.5vw 2vw;border-radius:1vw;'
+   'box-shadow:0 0 0 .3vw var(--kino-mint) inset}'
+ '.num{font-family:var(--kino-font);color:var(--kino-mint);font-weight:900;font-size:8vw}'
+ '.phone{width:9vw;height:15vw;border-radius:1.6vw;border:0.3vw solid var(--kino-white);'
+   'background:linear-gradient(var(--kino-green),var(--kino-night))}'
+ '</style>';
```

- [ ] **Step 2: One-beat harness**

Create `projects/kino-meta/specs/_b4.json`:

```json
{ "brand": "kino", "title": "_b4", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/range-tiles.js",
    "text": "Captions, avatars, motion. All of it.", "transition": "cut" } ] }
```

- [ ] **Step 3: Progression sheet**

Run: `kino still projects/kino-meta/specs/_b4.json --around 1.0 --span 1.6 --count 6`
**Read it.** PASS = tiles appear **one after another** (not all on tile 1), each rising+fading in; all three legible and inside the frame by the last tile. FAIL = simultaneous appearance → widen the `start` stagger; tiles clipped → lower `.wrap` `top` or tile heights.

- [ ] **Step 4: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/range-tiles.js projects/kino-meta/specs/_b4.json
git commit -m "feat(kino-meta): beat-4 capability range tiles"
```

---

### Task 7: beat 5 — CTA → loop-close (`close-window.js`) + seam proof

**Files:**
- Modify (via generator, already emitted in Task 2): `close-window.js`
- Create: `projects/kino-meta/specs/_b5.json`

**Interfaces:**
- Consumes: `WIN(...)`. Produces beat 5: CTA lockup fades in over the returning window, then in the final ~30% the lockup clears and the field empties so the **last frame == beat-0 frame 0** (empty prompt window, solid caret, native scale).

- [ ] **Step 1: One-beat harness**

Create `projects/kino-meta/specs/_b5.json`:

```json
{ "brand": "kino", "title": "_b5", "format": ["9:16"], "provider": "none", "film": 0,
  "segments": [ { "kind": "motion", "source": "motion/close-window.js",
    "text": "Kino. Tell your agent to make it.", "transition": "cut" } ] }
```

- [ ] **Step 2: Progression sheet (CTA → clear)**

Run: `kino still projects/kino-meta/specs/_b5.json --around 2.0 --span 3.6 --count 7`
**Read it.** PASS = early tiles show the `kino` wordmark + gold `tell your agent` pill over the window; **last tile = the empty prompt window, native scale, solid caret** (no CTA, no prompt text). FAIL = `env.duration` undefined error in logs → apply the Task-2 Step-1 note (`var total = 120;`), re-run `python3 gen-windows.py`, re-shoot.

- [ ] **Step 3: Seam pre-check (the whole point of the loop)**

Run: `kino still projects/kino-meta/specs/_b0.json --segment 0` (beat-0 frame 0)
and compare it to the **last tile** of Step 2.
PASS = they are the **same image**: same window position, same empty field, same solid mint caret, same scale, same grain. Any difference (scale, caret on/off, leftover text, CTA ghost) is a seam bug — fix `close-window.js`'s end state to converge exactly to `WIN("", true, "scale(1)", "")`.

- [ ] **Step 4: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion/close-window.js projects/kino-meta/specs/_b5.json
git commit -m "feat(kino-meta): beat-5 CTA + loop-close ready-state"
```

---

### Task 8: assemble `advert.json` (all 6 beats)

**Files:**
- Create: `projects/kino-meta/specs/advert.json`

**Interfaces:**
- Consumes: all six motion files. Produces the full spec — 6 beats, no captions, `provider:none`, `film:0`, VO copy finalized via `ad-voice`, a placeholder music bed (SFX added in Task 12 after real VO).

- [ ] **Step 1: Finalize VO copy via ad-voice**

Read the `ad-voice` skill, then tighten each beat's `text` (keep the beat 0 line = the literal prompt, and the beat 5 tail = the echoed prompt). Draft:

| Beat | text |
|---|---|
| 0 | `"Kino, make me an advert."` |
| 1 | `"There's no magic here."` |
| 2 | `"Your agent writes a spec —"` |
| 3 | `"— one command builds it. Voiceover, motion, render."` |
| 4 | `"Captions, avatars, motion. All of it."` |
| 5 | `"Kino. Tell your agent to make it. [short pause] Kino, make me an advert."` |

- [ ] **Step 2: Write `advert.json`**

Create `projects/kino-meta/specs/advert.json`:

```json
{
  "brand": "kino",
  "title": "advert",
  "format": ["9:16"],
  "provider": "none",
  "film": 0,
  "voiceModel": "eleven_multilingual_v2",
  "music": { "src": "ambient-night", "volume": 0.12, "duck": 0.04, "fadeInSec": 0.8, "fadeOutSec": 1.5 },
  "segments": [
    { "kind": "motion", "source": "motion/prompt-window.js",
      "text": "Kino, make me an advert.", "transition": "cut" },
    { "kind": "motion", "source": "motion/thinking-window.js",
      "text": "There's no magic here.", "transition": "cut" },
    { "kind": "motion", "source": "motion/spec-editor.js",
      "text": "Your agent writes a spec —", "transition": "dissolve" },
    { "kind": "motion", "source": "motion/build-terminal.js",
      "text": "— one command builds it. Voiceover, motion, render.", "transition": "dissolve",
      "triggers": [ { "at": 1.3, "action": "pulse" }, { "at": 1.75, "action": "pulse" }, { "at": 2.2, "action": "pulse" } ] },
    { "kind": "motion", "source": "motion/range-tiles.js",
      "text": "Captions, avatars, motion. All of it.", "transition": "dissolve" },
    { "kind": "motion", "source": "motion/close-window.js",
      "text": "Kino. Tell your agent to make it. Kino, make me an advert.", "transition": "dissolve" }
  ]
}
```

> If `kino music` has no `ambient-night` id, swap for one it lists (Step in Task 12), or drop the
> `music` block for now — it does not affect the visual loop.

- [ ] **Step 3: Inspect the beat map**

Run: `kino inspect projects/kino-meta/specs/advert.json`
Expected: 6 beats listed, mock durations, per-word timings printed. **No captions** reported on any beat. Total mock runtime roughly 18–24s. If it lands under ~20s, lengthen the beat 5 pause or beat 2/4 lines (target the middle of the range, not the floor).

- [ ] **Step 4: Full storyboard**

Run: `kino storyboard projects/kino-meta/specs/advert.json`
**Read** the storyboard PNG(s). PASS = the six beats read as a coherent arc (window → thinking → spec → build → range → CTA/close), palette consistent, nothing clipped. Note any beat-to-beat scale pops for the critique pass.

- [ ] **Step 5: Commit (scoped)**

```bash
git add projects/kino-meta/specs/advert.json
git commit -m "feat(kino-meta): assemble 6-beat advert spec"
```

---

### Task 9: adversarial critique (mock)

**Files:** none (review + fixes to existing motion files/spec)

- [ ] **Step 1: Run the critique skill**

Read and follow the `adversarial-critique` skill on `projects/kino-meta/specs/advert.json`. Provide it the storyboard **and** the per-beat `--around` sheets (beats 0,2,3,4,5 are animated/typed — one midpoint still is not enough).

- [ ] **Step 2: Triage findings**

For each finding (overlap, overflow, illegible text over the mint border, caption-band collisions, under-animation, scale pop between beats), fix the specific motion file or spec field. Re-shoot the affected `--around` sheet and Read it to confirm the fix.

- [ ] **Step 3: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion projects/kino-meta/specs/advert.json
git commit -m "fix(kino-meta): address adversarial-critique findings (mock)"
```

---

### Task 10: real build + retune to real VO

**Files:** none (retune existing motion files/spec)

**Interfaces:**
- Consumes: real per-word timings from the rendered VO. Produces the real mp4 with speech-locked typing and correctly-timed pipeline pulses.

- [ ] **Step 1: Real build**

Run: `kino build projects/kino-meta/specs/advert.json`
Expected: real ElevenLabs VO renders (faceless → no avatar spend), Remotion composites, `out/advert/…mp4` written. Note the path.

- [ ] **Step 2: Real word times**

Run: `kino inspect projects/kino-meta/specs/advert.json --real`
Expected: real per-word start/end per beat. Record beat 0's word starts (typing), beat 3's "Voiceover/motion/render" word times (pulse triggers), beat 5's echo start.

- [ ] **Step 3: Real progression sheets on every typed/animated beat**

Run (repeat per beat, `t` = a mid-typing real time from Step 2):
```
kino still projects/kino-meta/specs/advert.json --around <t> --real
```
or `kino frames out/advert/<file>.mp4 --around <t>`.
**Read each.** PASS = typing tracks the real VO (chars land as the word is spoken), beat-3 pulses land on their words. FAIL = drift → adjust `KEY_MS` (Task 2/4/5 files) so a word finishes typing as it finishes being spoken; move beat-3 `triggers[].at` in `advert.json` to the Step-2 real times.

- [ ] **Step 4: Rebuild + re-verify**

Run: `kino build projects/kino-meta/specs/advert.json` then re-shoot the worst beat's `--around … --real`. Repeat Steps 3–4 until typing and pulses lock. (VO is content-hash cached — retuning motion does not re-bill.)

- [ ] **Step 5: Commit (scoped)**

```bash
git add projects/kino-meta/assets/motion projects/kino-meta/specs/advert.json
git commit -m "fix(kino-meta): retune typing + pulses to real VO"
```

---

### Task 11: loop-seam verification (real)

**Files:** none (verification; fixes if needed)

- [ ] **Step 1: Pull the first and last real frames**

Run: `kino frames out/advert/<file>.mp4 --around 0.05 --span 0.1 --count 2` (start)
and `kino frames out/advert/<file>.mp4 --around <T-0.05> --span 0.1 --count 2` where `T` = the mp4 duration (end).
**Read both.** PASS = first frame and last frame are the **same** empty prompt window (position, empty field, solid mint caret, native scale, grain). 

- [ ] **Step 2: Eyeball the seam as it will loop**

Concatenate end→start visually: place the last-frame tile next to the first-frame tile (from Step 1 sheets) and confirm no jump. If a difference remains (caret blink phase, residual CTA opacity, scale), fix `close-window.js` end state and/or `prompt-window.js` frame-0 state, `python3 gen-windows.py`, rebuild, re-verify.

- [ ] **Step 3: Confirm loop playback intent**

Note in the deliverable README that the mp4 is designed for `<video autoplay muted loop>` (visual seam exact; audio bed fades at both ends). No file change if Steps 1–2 pass.

- [ ] **Step 4: Commit (scoped, only if files changed)**

```bash
git add projects/kino-meta/assets/motion
git commit -m "fix(kino-meta): lock loop seam on real frames"
```

---

### Task 12: sound — music bed + SFX

**Files:**
- Modify: `projects/kino-meta/specs/advert.json`

**Interfaces:**
- Consumes: real VO word times / audio markers. Produces the final audio: ducked ambient bed + light UI SFX (key-clicks under typing, send-pop, build chime), placed at real times.

- [ ] **Step 1: Pick a bed**

Run: `kino music` (bundled beds) and, if needed, `kino music "soft ambient pad loop"` (Freesound CC0; needs `FREESOUND_API_KEY`).
Set `music.src` in `advert.json` to a real id; `--get` a Freesound track into the project if using one.

- [ ] **Step 2: Get audio markers**

Run: `kino audio-markers projects/kino-meta/specs/advert.json` (or reuse `inspect --real`).
Record times for: beat-0 keystrokes (send-pop at the end of the typed prompt), beat-3 build-complete (last pipeline step), any accent you want.

- [ ] **Step 3: Add SFX (sparingly)**

Add to `advert.json` (bare ids resolve from `assets-lib/sfx/`; adjust `at` to Step-2 times):

```json
  "sfx": [
    { "src": "pop", "at": 3.4, "volume": 0.2 },
    { "src": "click", "at": 14.6, "volume": 0.18 }
  ]
```

- [ ] **Step 4: Rebuild + listen-check**

Run: `kino build projects/kino-meta/specs/advert.json`
Expected: VO cached (no re-bill); bed ducks under VO; SFX land on the moments, not mid-word. If an SFX is off, adjust `at` and rebuild. Confirm the bed **fades out** by the end so the loop bed doesn't click.

- [ ] **Step 5: Commit (scoped)**

```bash
git add projects/kino-meta/specs/advert.json
git commit -m "feat(kino-meta): ducked bed + light UI sfx"
```

---

### Task 13: final critique + ship

**Files:**
- Create: `projects/kino-meta/README.md` (short deliverable note)
- Delete: the `_b0.json … _b5.json` harness specs

- [ ] **Step 1: Final adversarial critique on real frames**

Follow `adversarial-critique` on the built mp4's frames (`kino frames … --around` at each beat's mid). Fix any real-VO layout shifts; rebuild if changed.

- [ ] **Step 2: Clean up harness specs**

Run: `rm projects/kino-meta/specs/_b*.json`

- [ ] **Step 3: Write a short deliverable note**

Create `projects/kino-meta/README.md`:

```markdown
# kino-meta — the kino advert

A ~22s looping advert for kino, made in kino. Faceless, no captions; the spoof
kino window types "Kino, make me an advert" in sync with the VO, reveals the
real flow (agent → spec → `kino build`), and loops seamlessly back into the prompt.

- Spec: `specs/advert.json`  ·  Output: `out/advert/…mp4`
- Play as `<video autoplay muted loop>` (first frame ≡ last frame).
- Design: `docs/superpowers/specs/2026-07-19-kino-advert-design.md`
```

- [ ] **Step 4: Final commit (scoped)**

```bash
git add projects/kino-meta/README.md
git rm projects/kino-meta/specs/_b0.json projects/kino-meta/specs/_b1.json projects/kino-meta/specs/_b2.json projects/kino-meta/specs/_b3.json projects/kino-meta/specs/_b4.json projects/kino-meta/specs/_b5.json
git commit -m "chore(kino-meta): ship advert + clean up harness specs"
```

- [ ] **Step 5: Deliver**

Report the final `out/advert/…mp4` path and confirm: 6 beats, no captions, seamless loop verified (Task 11), typing speech-locked (Task 10).

---

## Self-Review

**1. Spec coverage.** Design-spec sections → tasks:
- Concept / honest meta-reveal → Tasks 2–7 (beats), 8 (assembly). ✓
- Locked decisions (no captions, in-window typing, ~22s, loop, sound) → Global Constraints + Tasks 8/10/11/12. ✓
- Brand `kino` (palette, fonts, voice, v2, film 0, Tone/Voice) → Task 1. ✓
- Storyboard 6 beats → Tasks 2 (b0), 3 (b1), 4 (b2), 5 (b3), 6 (b4), 7 (b5). ✓
- Seamless loop (frame0≡last, no pop, static grain, solid caret, shared generator) → Global Constraints + Task 2 (frame-0 settled), Task 7 (converge), Task 11 (verify). ✓
- Look & finish (film 0, shared generator, burst typewriter, camera off time, vw) → Global Constraints + motion files. ✓
- Sound & voice → Task 1 (voice/model), Task 12 (bed/SFX). ✓
- env.words linchpin → Task 0. ✓
- Concept frames pre-viz → already produced; copied in Task 1 Step 4. ✓
- Risks (WIP build, seam, mock≠real, renderer-bug rule) → Task 0, Task 11, Task 10, Global Constraints. ✓

**2. Placeholder scan.** No "TBD/TODO/handle edge cases" left. The two intentional `<…>` are: brand Tone/Voice body (delegated to `ad-voice` by design) and font ids (must be read from `kino fonts` — can't be hardcoded blind). Both are explicit actions with the command to resolve them, not vague gaps.

**3. Type/name consistency.** `WIN(fieldHtml, caretOn, camStyle, ctaHtml)` defined in Task 2, consumed identically in Tasks 3/7. Motion source filenames match between `gen-windows.py` output, the harness specs, and `advert.json` (`prompt-window.js`, `thinking-window.js`, `close-window.js`, `spec-editor.js`, `build-terminal.js`, `range-tiles.js`). Palette hexes identical everywhere. Loop end state `WIN("", true, "scale(1)", "")` in Task 7 matches beat-0 `t=0` (`out=""`, caret solid via `env.frame<5`, `S=1`).

**Known tuning knobs (expected, not defects):** `KEY_MS`, camera scale amounts, pipeline `state()` schedule, tile stagger, and all trigger `at` times are first-pass values the `--around` loop (Tasks 2–7) and the real-VO retune (Task 10) exist to dial in.
