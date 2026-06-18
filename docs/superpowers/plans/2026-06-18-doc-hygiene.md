# kino Documentation Hygiene — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make kino's docs accurate, rewrite the README into an evergreen shape with a CHANGELOG, and document the source so it's easy to understand — with only safe, test-verified code changes (dead-code removal + non-exported renames).

**Architecture:** Three workstreams executed in order — (A) doc accuracy fixes, (B) README rewrite + CHANGELOG, (C) in-code documentation pass + safe code changes. No feature/logic/public-API changes.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Remotion/React, Zod, Commander, vitest, tsc.

---

## How to verify in this plan (read first)

This is a **documentation** effort, so the usual write-a-failing-test TDD loop does not apply to most tasks. Two verification modes are used instead:

- **Code-touching tasks** (dead-code deletion, renames, the `replicate.ts` comment fix) — the existing vitest suite is the safety net. After the change, run:
  ```bash
  npm run build && npm test
  ```
  Expected: tsc exits 0 (no type errors) and all vitest suites pass.
- **Doc-only tasks** — verification is re-checking the new text against the live source. Each task gives the exact `grep`/read to run and what you must see.

**Commit after every task.** Branch is already `chore/docs-hygiene`. Commit trailer for all commits:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

---

## File map

**Workstream A (doc accuracy):** `src/avatar/replicate.ts` (comment), `docs/getting-started.md`, `docs/README.md`, `docs/spec-reference.md`, `docs/cli-reference.md`, `docs/motion-graphics.md`.
**Workstream B (README/changelog):** `README.md` (rewrite), `CHANGELOG.md` (create).
**Workstream C (code docs + safe changes):** `src/vo/vo.ts`, `src/vo/elevenlabs.ts`, `src/media/cache.ts`, `src/media/hash.ts`, `src/media/ffmpeg.ts`, `src/avatar/replicate.ts`, `src/avatar/hedra.ts`, `src/avatar/plan.ts`, `src/spec/schema.ts`, `src/config/env.ts`, `src/spec/validate.ts`, `src/config/brand.ts`, `src/cli.ts`, `src/log.ts`, `src/commands/build.ts`, `src/commands/batch.ts`, `src/commands/voices.ts`, `src/render/remotion/KinoVideo.tsx`, `src/render/remotion/MotionGraphic.tsx`, `src/render/remotion/backgrounds/CanvasBackground.tsx`, `src/render/remotion/components.tsx`, `src/render/bgparams.ts`, `src/fonts/manager.ts`.

---

# Workstream A — Doc accuracy

### Task 1: Fix the actively-wrong `replicate.ts` default-model comment

**Files:**
- Modify: `src/avatar/replicate.ts:6-7`

- [ ] **Step 1: Replace the wrong comment.** The comment claims the default model is SadTalker, but `src/avatar/avatar.ts:25` defaults to `bytedance/omni-human` (SadTalker is the abandoned community option). Replace lines 6-7:

  Current:
  ```ts
  // Default model is an image+audio talking-head (SadTalker); field names are overridable
  // per brand because each lip-sync model names its inputs differently.
  ```
  New:
  ```ts
  // The default model (set in avatar.ts → replicateCfg) is bytedance/omni-human, an image+audio
  // talking-head that boots reliably on Replicate. Field names are overridable per brand because
  // each lip-sync model names its inputs differently.
  ```

- [ ] **Step 2: Verify build.** Run: `npm run build`  Expected: exits 0.
- [ ] **Step 3: Commit.**
  ```bash
  git add src/avatar/replicate.ts
  git commit -m "docs(avatar): correct replicate default-model comment (omni-human, not SadTalker)"
  ```

---

### Task 2: Migrate `brand.json` → `brand.md` in the docs

**Files:**
- Modify: `docs/getting-started.md`, `docs/README.md`, `docs/spec-reference.md`

Context: the brand format moved to markdown. `src/config/brand.ts` `loadBrandDoc` throws "brands are markdown now — create a brand.md", and `src/commands/init.ts` scaffolds `brand.md` (YAML frontmatter: any subset of palette/font/voice/disclosure, merged over `DEFAULT_BRAND`; free-form guidelines body read via `kino brand <name>`).

- [ ] **Step 1: Find every stale reference.**
  ```bash
  grep -rn 'brand\.json' docs/
  ```
  Expected before: hits in `getting-started.md`, `README.md`, `spec-reference.md`.

- [ ] **Step 2: Read the real format** so the rewrite is accurate: read `src/commands/init.ts` (the scaffolded `brand.md` template), `src/config/brand.ts` (`BrandFrontmatterSchema`, `DEFAULT_BRAND`, `loadBrandDoc`).

- [ ] **Step 3: Update `docs/getting-started.md` and `docs/README.md`** — replace each `brand.json` mention with `brand.md`; describe it as "YAML frontmatter (optional subset of palette/font/voice/disclosure) + a free-form guidelines body," not a JSON file.

- [ ] **Step 4: Rewrite the `## brand.json` section of `docs/spec-reference.md`** — retitle to `## brand.md` and replace the JSON example with a real `brand.md` example matching `init.ts`'s scaffold: frontmatter block (`---` … `---`) followed by a guidelines body. State that frontmatter is merged over `DEFAULT_BRAND` and that the body is surfaced to the agent via `kino brand <name>`.

- [ ] **Step 5: Verify.**
  ```bash
  grep -rn 'brand\.json' docs/
  ```
  Expected after: no results (zero `brand.json` references remain).

- [ ] **Step 6: Commit.**
  ```bash
  git add docs/
  git commit -m "docs: replace removed brand.json with the markdown brand.md format"
  ```

---

### Task 3: Fix the "required" brand-field markers in spec-reference

**Files:**
- Modify: `docs/spec-reference.md` (the brand fields table)

Context: `BrandFrontmatterSchema` in `src/config/brand.ts` makes **every** field `.optional()` with `DEFAULT_BRAND` fallbacks. Nothing in a brand is required.

- [ ] **Step 1: Confirm the schema.**
  ```bash
  grep -n 'optional\|required\|DEFAULT_BRAND' src/config/brand.ts
  ```
  Expected: brand frontmatter fields are `.optional()`.

- [ ] **Step 2: Edit the table** — remove the ✅/required markers on `name`, `colors`, `disclosure` (and any other field marked required). Add a one-line note above the table: "All brand fields are optional; anything omitted falls back to `DEFAULT_BRAND`."

- [ ] **Step 3: Verify** by re-reading the edited table against the schema field list. Each field's "required" status must read optional.

- [ ] **Step 4: Commit.**
  ```bash
  git add docs/spec-reference.md
  git commit -m "docs(spec): brand fields are all optional with DEFAULT_BRAND fallbacks"
  ```

---

### Task 4: Document the `kino brand [name]` command

**Files:**
- Modify: `docs/cli-reference.md`

- [ ] **Step 1: Read the command definition** in `src/cli.ts` (the `brand` command registration) and `src/commands/brand.ts` to get the exact name, argument, and behavior.

- [ ] **Step 2: Add a `kino brand [name]` entry** to `cli-reference.md`, placed alphabetically/with the other read-only commands. Describe: prints a brand's resolved config + guidelines body (the text the agent reads before authoring a spec). Match the documentation style of the surrounding command entries.

- [ ] **Step 3: Verify** the documented flags/args match `src/cli.ts`:
  ```bash
  grep -n "brand" src/cli.ts
  ```

- [ ] **Step 4: Commit.**
  ```bash
  git add docs/cli-reference.md
  git commit -m "docs(cli): document the kino brand command"
  ```

---

### Task 5: Fix the motion-graphics CSS-var docs (`--kino-caption-bottom` + `--kino-gold`)

**Files:**
- Modify: `docs/motion-graphics.md`

Context: `src/render/motionVars.ts` is the source of truth for which CSS variables kino injects each frame. The docs are missing `--kino-caption-bottom` and contradict themselves on `--kino-gold` (docs say "gold accent is not auto-injected"; `src/commands/motion.ts` help lists it as auto-injected).

- [ ] **Step 1: Read the source of truth.** Read `src/render/motionVars.ts` fully and list every `--kino-*` variable it sets. Also read the `--kino-gold` line in `src/commands/motion.ts` help text.

- [ ] **Step 2: Add `--kino-caption-bottom`** to the CSS-variable contract table in `motion-graphics.md`, with its meaning (the caption band's bottom offset, in px) per `motionVars.ts`.

- [ ] **Step 3: Reconcile `--kino-gold`.** Determine the truth from `motionVars.ts`: is `--kino-gold` set every frame? If yes → fix the doc sentence to say it IS auto-injected. If no → fix `src/commands/motion.ts` help text instead (this is the one allowed code edit in this task; it's help-string text, not logic). Make the doc, `motionVars.ts`, and `motion.ts` help agree.

- [ ] **Step 4: Verify.** The full set of `--kino-*` vars in the doc table must equal the set produced by `motionVars.ts`:
  ```bash
  grep -n 'kino-' src/render/motionVars.ts
  ```
  Cross-check each against the doc table; no var present in code may be missing from the doc, and the `--kino-gold` statement must match the code.

- [ ] **Step 5: Verify build** (only if `motion.ts` was edited): `npm run build`  Expected: exits 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add docs/motion-graphics.md src/commands/motion.ts
  git commit -m "docs(motion): document --kino-caption-bottom; reconcile --kino-gold auto-injection"
  ```

---

# Workstream B — README rewrite + CHANGELOG

### Task 6: Create `CHANGELOG.md`

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create `CHANGELOG.md`** with the content below (reconstructed from git tags + release commits; "Keep a Changelog" style, newest first):

  ````markdown
  # Changelog

  All notable changes to kino are documented here. This project uses semantic-ish
  versioning; the authoritative version is the `version` field in `package.json`.

  ## [1.15.0] — Markdown brands
  - Brands are now `brands/<name>/brand.md` (YAML frontmatter + guidelines body),
    replacing the old `brand.json`. Frontmatter is an optional subset merged over `DEFAULT_BRAND`.

  ## [1.14.0] — Procedural motion graphics (Tier 2)
  - Motion graphics gain a procedural tier driven per-frame by kino.

  ## [1.13.0] — Motion graphics (Tier 1)
  - Agent-authored HTML/CSS beats & overlays driven by kino-set CSS variables, deterministic in
    Remotion; scrubbed `@keyframes` (`class="kino-anim"`) and a `.kino-cliptext` helper.

  ## [1.12.0] — Video inspection
  - External reference-video analysis: `transcribe` / `scan`; `frames` extraction flags.

  ## [1.11.1] — App cut-in backdrop
  - Brand backdrop rendered behind app cut-ins in avatar mode.

  ## [1.11.0] — Word-caption polish
  - Highlight the active word and render the brand name in brand green in word captions.

  ## [1.10.0] — Replicate default model
  - Default Replicate avatar model is now `bytedance/omni-human`.

  ## [1.9.2] — Replicate provider fix
  - Make the Replicate provider actually run end-to-end.

  ## [1.9.1] — Inter-beat gap hold
  - Hold visuals through the inter-beat VO gap (no bare-background flash).

  ## [1.9.0] — Easing
  - Spring + overshoot keyframe easing.

  ## [1.8.1] — Relative caption keyframes
  - Per-segment caption/kicker keyframes are segment-relative.

  ## [1.8.0] — Tweenable captions & kickers
  - Captions and kickers join the shared keyframe system (every overlay tweenable).

  ## [1.7.0] — Configurable logo
  - Configurable + tweenable logo (`AnimatedElement`).

  ## [1.6.0] — Animatable backgrounds
  - Agent-animatable backgrounds; word timestamps surfaced in `inspect`.

  ## [1.5.0] — Projects
  - `projects/<name>/` brand-assignable file scoping.

  ## [1.4.1] — Font override
  - `--font` override for `build`/`still`/`storyboard`.

  ## [1.4.0] — Font library
  - On-demand font library; `-font` labels.

  ## [1.3.0] — Agent inspection
  - `inspect` / `still` / `storyboard` / `frames` commands.

  ## [1.2.0] — Word-synced captions
  - Real per-word timestamps + caption effect kit.

  ## [1.1.0] — Output tagging
  - Variant output tagging so renders don't overwrite each other.

  ## [1.0.0] — Initial release
  - spec → VO (ElevenLabs) → avatar (HeyGen) → Remotion composite → MP4.
  ````

- [ ] **Step 2: Verify** the latest entry version equals `package.json`:
  ```bash
  grep '"version"' package.json   # expect 1.15.0, matching the top CHANGELOG entry
  ```

- [ ] **Step 3: Commit.**
  ```bash
  git add CHANGELOG.md
  git commit -m "docs: add CHANGELOG.md as the home for version history"
  ```

---

### Task 7: Rewrite `README.md` into an evergreen shape

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Replace `README.md`** with the content below. It drops all `(v1.x)` markers and the Status blockquote, states no hardcoded version, adds a one-line pipeline overview and a brief Development section, and points version history at `CHANGELOG.md`. Keep the existing logo and brand-assets table.

  ````markdown
  <p align="center">
    <img src="logo/kino-logo.png" alt="kino — /ˈkiːnoʊ/ n. German: cinema, from Greek kīnēma: motion" width="560">
  </p>

  <p align="center"><em>Agent-driven short-form video production — spec in, video out.</em></p>

  ---

  **kino** turns an agent-authored JSON spec into finished vertical videos. The driving agent supplies
  the creative; kino handles deterministic production: ElevenLabs voiceover, an optional AI avatar
  (HeyGen / Hedra / Replicate) or a **faceless** background, composited in Remotion to a 9:16 / 3:4 MP4.

  ## Pipeline at a glance
  ```
  spec.json ─▶ validate ─▶ voiceover (ElevenLabs) ─▶ avatar plan + trim
            ─▶ avatar (HeyGen/Hedra/Replicate) or faceless background
            ─▶ Remotion composite ─▶ ffmpeg ─▶ out/<title>/…mp4
  ```
  The agent authors specs; kino performs every step deterministically (no LLM inside the CLI).

  ## Install
  ```bash
  cd <your-project> && bash ~/kino/setup.sh   # installs the `kino` command + writes a project .env
  ```
  `setup.sh` runs `npm install` / `build` / `link` and prompts for API keys (written to a `chmod 600`,
  git-ignored `.env`). Manual install:
  ```bash
  cd ~/kino && npm install && npm run build && npm link
  ```
  Requires Node 18+, ffmpeg/ffprobe (+ ImageMagick for storyboards). Faceless needs only an ElevenLabs key.

  ## Quickstart
  ```bash
  cd <project> && kino init evidentcv     # scaffold .env, brand.md, dirs
  kino doctor                             # preflight: keys, ffmpeg, fonts
  kino build specs/lie-test.json --mock   # free structural preview (no API spend)
  kino build specs/lie-test.json          # real render → out/lie-test/
  ```
  The driving agent authors specs — see [`skills/video-production`](skills/video-production/SKILL.md).

  ## Features
  - **Avatar engines** — `none` (faceless, $0), `heygen` (Avatar-IV), `hedra` (Character-3),
    `replicate` (open-source lip-sync). Avatars are trimmed to on-camera segments to cut spend;
    VO + avatar are content-hash cached.
  - **Faceless backgrounds** — `glow`, `image`, `mesh`, `aurora`, `particles`, `grid`, `custom` —
    frame-deterministic Canvas2D, auto-coloured from the brand.
  - **Captions** — `phrase` (editorial block) or `words` (revealed word-by-word, synced to real VO
    timestamps, with active-word highlight + per-segment emphasis).
  - **Fonts** — curated names (`kino fonts`) downloaded on demand (Google Fonts → `~/.kino/fonts/`),
    or any raw CSS family.
  - **Animated backgrounds & overlays** — backgrounds, logo, captions, and kickers are all tweenable
    on one keyframe layer (`backgroundKeyframes`/`logoKeyframes`/…), with timed `backgroundTriggers`.
  - **Motion graphics** — author a self-contained HTML/CSS file in `assets/motion/`; kino drives it
    per-frame via CSS variables, with scrubbed `@keyframes` and a `.kino-cliptext` helper, sanitized
    and determinism-linted. See [docs/motion-graphics.md](docs/motion-graphics.md).
  - **Branding & compliance** — logo mark + a per-mode AI `disclosure`; brand `bannedPhrases` fail
    the build (no guaranteed-outcome copy).
  - **Inspect & iterate** — `inspect` (plan as JSON), `still`/`storyboard` (fast mock previews),
    `frames` (extract from a render). Built for tight agent loops.
  - **Brands & projects** — optional `brands/<name>/brand.md` (markdown frontmatter + guidelines);
    `projects/<name>/` scopes each campaign's specs/assets/out. Flat layout still works.

  ## Documentation
  Full guides live in [`docs/`](docs/):
  - [Getting started](docs/getting-started.md) — install, scaffold, first render.
  - [CLI reference](docs/cli-reference.md) — every command + flag.
  - [Spec reference](docs/spec-reference.md) — the JSON spec, `brand.md`, `project.json`.
  - [Motion graphics](docs/motion-graphics.md) — author custom animated beats/overlays in HTML/CSS.
  - [Backgrounds & overlays](docs/backgrounds-and-overlays.md) — faceless backgrounds, logo, captions, kickers.

  ## Development
  ```bash
  npm run build     # tsc → dist/
  npm test          # vitest (run once);  npm run test:watch to watch
  npm run dev -- <args>   # run the CLI from source via tsx
  ```
  Work on a feature branch (`feat/…`, `fix/…`, `chore/…`), bump `version` in `package.json` for
  releases, and open a PR to `main`. Version history lives in [`CHANGELOG.md`](CHANGELOG.md).

  ## Brand assets (`logo/`)
  | File | Use |
  |---|---|
  | `kino-logo.png` | **Light master** — wordmark + etymology note (cream); used in this README |
  | `kino-wordmark.png` | Wordmark + brackets only |
  | `kino-logo-transparent.png` | Transparent (line-art; for **light** backgrounds) |
  | `kino-logo-dark.png` | **Dark master** — white ink on night |
  | `kino-logo-dark-transparent.png` | Transparent dark-mode (overlay on **dark**) |
  | `kino-icon.png` | 1024×1024 square icon |
  ````

- [ ] **Step 2: Verify** no version markers or stale brand.json remain:
  ```bash
  grep -nE '\(v1\.|Status:|brand\.json' README.md
  ```
  Expected: no results.

- [ ] **Step 3: Verify** every `docs/…` and `skills/…` link in the README points to a file that exists:
  ```bash
  for f in docs/getting-started.md docs/cli-reference.md docs/spec-reference.md docs/motion-graphics.md docs/backgrounds-and-overlays.md skills/video-production/SKILL.md CHANGELOG.md; do test -f "$f" && echo "OK $f" || echo "MISSING $f"; done
  ```
  Expected: all `OK`.

- [ ] **Step 4: Commit.**
  ```bash
  git add README.md
  git commit -m "docs: rewrite README into evergreen shape (pipeline, quickstart, dev, changelog link)"
  ```

---

# Workstream C — In-code documentation pass + safe changes

> For each file-header task below, add a concise top-of-file block comment (`//` lines or `/** */`) stating the file's responsibility and any non-obvious contract. Where a drafted header is given, verify it against the live file and adjust wording if the code has drifted — the code is the source of truth.

### Task 8: Document & clean up `vo-and-media`

**Files:**
- Modify: `src/vo/vo.ts`, `src/vo/elevenlabs.ts`, `src/media/cache.ts`, `src/media/hash.ts`, `src/media/ffmpeg.ts`

- [ ] **Step 1: Delete dead code in `elevenlabs.ts`.** Remove the unused exported `tts()` (lines ~36-50) and `ttsMock()` (lines ~52-56) — confirmed zero callers (`grep -rn 'tts\b\|ttsMock' src tests` shows only their definitions and one comment). Then fix the now-dangling comment on the `ttsWithTimestamps` function (currently `// Like tts(), but also returns clip-relative word timings…`) to not reference the deleted `tts()`, e.g.:
  ```ts
  // ElevenLabs TTS that also returns clip-relative word timings (for word-synced captions).
  ```

- [ ] **Step 2: Add the audio-format coupling note in `elevenlabs.ts`.** Above `DEFAULT_SETTINGS` / the `mp3_44100_128` query param, add:
  ```ts
  // AUDIO FORMAT COUPLING: requests use mp3_44100_128 (44.1 kHz, 128 kbps MP3). This MUST stay in
  // sync with ffmpeg.ts (libmp3lame -b:a 128k, anullsrc r=44100) — the stitched track and the
  // per-clip VO must share a format, and the format is baked into the content-hash cache key, so
  // changing it here without changing ffmpeg.ts (and vice-versa) silently invalidates the cache.
  ```

- [ ] **Step 3: Mirror the note in `ffmpeg.ts`.** Above the `libmp3lame`/`128k`/`44100` constants in the silence + stitch helpers, add a one-liner: `// Keep 44100/128k MP3 in sync with elevenlabs.ts mp3_44100_128 (shared format + cache key).`

- [ ] **Step 4: Add a file header + `GAP` doc to `vo.ts`.**
  ```ts
  // VO orchestration: turns spec.segments into a stitched voiceover track + per-word timings.
  // Each segment is TTS'd (or mocked) and content-hash cached (mp3 + json), then the clips are
  // concatenated with a fixed inter-segment GAP into one continuous track. Pure orchestration —
  // no avatar/render concerns. Public API: buildVO() → VOResult.
  ```
  And above `GAP`:
  ```ts
  // Seconds of silence inserted between segments in the stitched track. Also part of the track
  // cache key (contentHash({clips, GAP})) — changing it re-stitches but does not re-bill TTS.
  export const GAP = 0.32;
  ```

- [ ] **Step 5: Doc-comment `buildVO` / `VOResult` contract in `vo.ts`.** Above `buildVO`:
  ```ts
  /**
   * Build the voiceover for a spec. Per segment: reuse the cached mp3+json if present, else TTS
   * (real ElevenLabs when !mock, silence+fake timings when mock) and cache the result. Then probe
   * durations, compute timeline timings with GAP, offset clip-relative word times onto the timeline,
   * and stitch one continuous track (also cached).
   * Contract: apiKey is required unless mock=true (real TTS calls assert it). Side effects: writes
   * into the Cache dir and a temp dir. Returns the stitched track path, per-clip paths, timings, and
   * timeline-absolute word timings.
   */
  ```

- [ ] **Step 6: Add a file header + method docs to `cache.ts`.**
  ```ts
  // Content-addressed file cache used across the pipeline (VO clips, stitched track, avatar mp4).
  // The key is a content hash (see hash.ts); files are stored as `${key}.${ext}` under one dir
  // (typically .kino-cache/). This lets edits that don't change inputs reuse paid API output for
  // free. NOTE: the cache is append-only and never evicted — it grows unbounded; clear it by hand.
  ```
  Add a one-line comment on `get` (returns the path if present, else null) and `put` (copies src in, returns the cached path).

- [ ] **Step 7: Add a file header to `hash.ts`.**
  ```ts
  // Deterministic content hashing for cache keys. stable() serializes objects with sorted keys so
  // that key order never changes the hash; contentHash() returns the first 16 hex chars of the
  // SHA-256. Used everywhere a "did the inputs change?" cache decision is made.
  ```

- [ ] **Step 8: Verify.** Run: `npm run build && npm test`  Expected: tsc exits 0; all vitest suites pass (dead-code removal must not break any test).

- [ ] **Step 9: Commit.**
  ```bash
  git add src/vo/vo.ts src/vo/elevenlabs.ts src/media/cache.ts src/media/hash.ts src/media/ffmpeg.ts
  git commit -m "docs(vo,media): headers + API docs, audio-format coupling note; drop dead tts helpers"
  ```

---

### Task 9: Rename cryptic non-exported avatar helpers

**Files:**
- Modify: `src/avatar/replicate.ts`, `src/avatar/hedra.ts`, `src/avatar/plan.ts`

All three symbols are single-file and non-exported (verified), so renames are local.

- [ ] **Step 1: `replicate.ts`** — rename `rj` → `replicateFetch` (definition line ~19 and all call sites: ~61, ~65, ~80). Optionally add a one-line doc: `// Authenticated JSON fetch against the Replicate API (throws on non-2xx).`

- [ ] **Step 2: `hedra.ts`** — rename `hj` → `hedraFetch` (definition line ~18 and call sites ~34, ~47, ~63, ~84). Optionally add: `// Authenticated JSON fetch against the Hedra API (throws on non-2xx).`

- [ ] **Step 3: `plan.ts`** — rename the local `posOf` map → `origIndexToTrackPos` (definition line ~33 and use at ~46). A one-line comment already nearby explains it maps original segment index → position in the trimmed avatar track.

- [ ] **Step 4: Verify the old names are gone.**
  ```bash
  grep -rn '\bhj\b\|\brj\b\|\bposOf\b' src
  ```
  Expected: no results.

- [ ] **Step 5: Verify.** Run: `npm run build && npm test`  Expected: tsc 0; tests pass.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/avatar/replicate.ts src/avatar/hedra.ts src/avatar/plan.ts
  git commit -m "refactor(avatar): rename cryptic local helpers (hj→hedraFetch, rj→replicateFetch, posOf→origIndexToTrackPos)"
  ```

---

### Task 10: Document `spec-and-config`

**Files:**
- Modify: `src/spec/schema.ts`, `src/config/env.ts`, `src/spec/validate.ts`, `src/config/brand.ts`

- [ ] **Step 1: Read** all four files first.

- [ ] **Step 2: File header for `schema.ts`** — it is the central agent-authored contract. Draft (verify/adjust against the file):
  ```ts
  // THE SPEC CONTRACT. Zod schema for the agent-authored spec.json that drives a build: title,
  // format, segments (hook/avatar/app/motion…), captions, background, overlays, keyframes. This is
  // the single source of truth for what an agent may author; keep it and docs/spec-reference.md in
  // sync. Exports the Spec type used throughout the pipeline. Note: keyframe `at` is in <UNIT —
  // confirm from the schema: seconds or frames>.
  ```
  Resolve the `at` unit from the schema and state it explicitly (drop the `<…>` placeholder).

- [ ] **Step 3: File header for `env.ts`** — describe how env/.env is loaded and which keys it reads. Draft:
  ```ts
  // Environment & .env loading. Reads API keys (ElevenLabs / HeyGen / Hedra / Replicate) and flags
  // (e.g. KINO_DEBUG) from process.env / the workspace-root .env. Central place for "where do
  // secrets come from"; commands pull keys through here rather than touching process.env directly.
  ```
  Verify the exact key names + behavior against the file before committing the wording.

- [ ] **Step 4: Doc the resolver trio in `validate.ts`** — add a comment explaining the asymmetry: `resolveVoice` returns `''` as a "no voice configured" sentinel (faceless is valid), whereas `resolveVoiceLook` throws (an avatar build with no look is unrecoverable). Document the brand-alias passthrough. Place a short `/** */` over each resolver.

- [ ] **Step 5: Doc the Brand split in `brand.ts`** — add a comment above the two near-mirror types explaining the design: the frontmatter type is the partial, optional on-disk shape; the resolved `Brand` type is the fully-populated shape after merging over `DEFAULT_BRAND`. They look duplicated but model two distinct states (on-disk vs resolved) on purpose.

- [ ] **Step 6: Verify.** Run: `npm run build`  Expected: exits 0 (comments only; no behavior change).

- [ ] **Step 7: Commit.**
  ```bash
  git add src/spec/schema.ts src/config/env.ts src/spec/validate.ts src/config/brand.ts
  git commit -m "docs(spec,config): headers + resolver/brand-split contracts"
  ```

---

### Task 11: Document `cli-and-commands` idioms

**Files:**
- Modify: `src/cli.ts`, `src/log.ts`, `src/commands/build.ts`, `src/commands/batch.ts`, `src/commands/voices.ts`

- [ ] **Step 1: `cli.ts` header + lazy-import note.** Add a file header and explain the idiom:
  ```ts
  // CLI entry: registers every command with Commander and version (from package.json). Each action
  // uses a lazy `await import("./commands/x.js")` ON PURPOSE — it keeps startup fast (only the
  // invoked command's module + its heavy deps like Remotion load) and isolates a broken command
  // from crashing the whole CLI. Not a mistake; do not hoist these to top-level imports.
  ```

- [ ] **Step 2: `log.ts` stderr note.** Add above the logger:
  ```ts
  // All log levels (including info/ok) write to STDERR on purpose. stdout is reserved for machine
  // output (e.g. `inspect`/`transcribe` print JSON to stdout for piping); routing logs to stderr
  // keeps that stream clean. Don't "fix" these to console.log.
  ```

- [ ] **Step 3: `build.ts` header + `KICKER_FG`.** Add a header noting `build.ts` is the pipeline backbone and `prepare()` is the shared resolver reused by preview commands. Comment the `KICKER_FG` hex map (what each colour keys to) and reference the central palette doc added in Task 13.

- [ ] **Step 4: `batch.ts` and `voices.ts` headers.** One-line top-of-file comment each stating responsibility (batch: build many specs in one invocation; voices: list/inspect ElevenLabs voices). Verify against the files.

- [ ] **Step 5: Verify.** Run: `npm run build`  Expected: exits 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/cli.ts src/log.ts src/commands/build.ts src/commands/batch.ts src/commands/voices.ts
  git commit -m "docs(cli): headers + document stderr-logging and lazy-import idioms"
  ```

---

### Task 12: Document `render-remotion`

**Files:**
- Modify: `src/render/remotion/KinoVideo.tsx`, `src/render/remotion/MotionGraphic.tsx`, `src/render/remotion/backgrounds/CanvasBackground.tsx`, `src/render/remotion/components.tsx`

- [ ] **Step 1: `KinoVideo.tsx` header with explicit z-order.** Add:
  ```tsx
  // Top-level Remotion composition. Layers render back-to-front in this order:
  //   1. backdrop/background  2. avatar video  3. app cut-ins  4. motion graphics
  //   5. overlays (kickers)   6. logo          7. captions     8. AI disclosure
  // Anything added must be slotted into this stack deliberately. `f` below converts seconds→frames
  // (sec * fps).
  ```
  Adjust the list to the actual render order in the file if it differs; keep it accurate.

- [ ] **Step 2: `useLayoutEffect` per-frame note** in both `MotionGraphic.tsx` and `CanvasBackground.tsx`. Above each effect:
  ```tsx
  // Intentional: this re-runs on the frame-derived inputs to redraw every frame. The dep array is
  // deliberate (Remotion advances frame-by-frame); it is NOT a missing-deps bug — do not add a [].
  ```

- [ ] **Step 3: Eval trust-boundary note** at both `new Function(...)` sites (`components.tsx` FacelessBackdrop, `MotionGraphic.tsx` Tier-2). Use a shared wording:
  ```tsx
  // TRUST BOUNDARY: new Function() executes config-supplied code. This is safe ONLY because the
  // source is trusted local project config that has already passed the sanitize + determinism lint
  // (see src/render/sanitizeMotion.ts). Never feed untrusted/remote input here.
  ```

- [ ] **Step 4: Comment `CAPTION_BOTTOM` and the worst magic-number walls** in `components.tsx` (spring/scale constants) with a unit + one-line rationale each. Don't change values — explain them.

- [ ] **Step 5: Verify.** Run: `npm run build`  Expected: exits 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/render/remotion/
  git commit -m "docs(remotion): KinoVideo z-order, per-frame effect + eval trust notes, magic constants"
  ```

---

### Task 13: Document `render-core`, `fonts`, and centralize the palette

**Files:**
- Modify: `src/render/bgparams.ts`, `src/fonts/manager.ts`, `src/config/brand.ts` (palette home)

- [ ] **Step 1: Find the palette's canonical home.**
  ```bash
  grep -rn 'night\|mint\|gold' src/config/brand.ts src/render/props.ts src/commands/build.ts | head
  ```
  The five-slot palette (night / mint / green / white / gold) is the brand colour set; its canonical definition is `DEFAULT_BRAND.colors` in `src/config/brand.ts`.

- [ ] **Step 2: Write the palette doc once** above `DEFAULT_BRAND.colors` in `brand.ts`: name each slot and its role (e.g. night = background, mint = primary accent, green = brand/active-word highlight, white = foreground text, gold = secondary accent). Other sites (`build.ts` `KICKER_FG`, `components.tsx`) reference it via a short `// see DEFAULT_BRAND.colors in config/brand.ts` comment rather than re-explaining.

- [ ] **Step 3: Comment the easing constants in `bgparams.ts`** — give each a name + formula reference (e.g. `1.70158` is the back-ease overshoot constant; `2π/3` is the elastic-ease period; note smoothstep/spring). Don't change math.

- [ ] **Step 4: `manager.ts` header** — describe on-demand font download (Google Fonts → `~/.kino/fonts/`), and add a one-line note on the legacy-UA download trick and the weight magic numbers.

- [ ] **Step 5: Verify.** Run: `npm run build`  Expected: exits 0.

- [ ] **Step 6: Commit.**
  ```bash
  git add src/render/bgparams.ts src/fonts/manager.ts src/config/brand.ts
  git commit -m "docs(render,fonts): centralize palette doc, explain easing constants + font manager"
  ```

---

### Task 14: Final verification sweep

- [ ] **Step 1: Full build + test.** Run: `npm run build && npm test`  Expected: tsc exits 0; all vitest suites pass.

- [ ] **Step 2: No stale references remain.**
  ```bash
  grep -rn 'brand\.json' docs/ README.md ; grep -nE '\(v1\.|Status:' README.md ; grep -rn '\bhj\b\|\brj\b\|\bposOf\b' src ; grep -rn 'SadTalker' src
  ```
  Expected: no results from any of these (SadTalker should only survive, if at all, as the corrected "abandoned community option" mention in `replicate.ts`/`avatar.ts` — confirm any remaining mention is accurate, not a "default model" claim).

- [ ] **Step 3: Doctor smoke (optional, no spend).** Run: `npm run dev -- doctor`  Expected: runs without throwing.

- [ ] **Step 4: Final commit if anything was touched in the sweep**, then this branch is ready for review/merge per superpowers:finishing-a-development-branch.

---

## Self-review notes (author)

- **Spec coverage:** Every spec item maps to a task — A1–A5 = Workstream A (replicate comment in Task 1; brand.json in 2; required markers in 3; `kino brand` in 4; caption-bottom/gold in 5); B = Tasks 6–7; C file-headers/API-docs/idioms/constants/eval/palette spread across Tasks 8–13; safe code changes in Tasks 8 (dead code) and 9 (renames). Final sweep = Task 14.
- **Out of scope (per spec non-goals):** no CONTRIBUTING/troubleshooting/.env.example files; no util extraction or `ParamValue` consolidation (those are referenced-in-comments only, Tasks 11/13).
- **Type/name consistency:** rename targets and their call-site line ranges verified by grep before planning; `replicateFetch`/`hedraFetch`/`origIndexToTrackPos` used consistently in Task 9 and the Task 14 sweep.
- **Verification:** every code-touching task ends in `npm run build` (+ `npm test` where deletion/rename could break behavior); doc tasks end in a concrete grep/read check.
