# Tier 3: Embedded Lottie motion graphics — design

- **Date:** 2026-06-19
- **Status:** Approved (brainstorming) — pending implementation plan
- **Branch (target):** new branch off `main`, e.g. `feat/motion-lottie`
- **Related:** [motion-graphics.md](../../motion-graphics.md), Tier 1 (HTML/CSS) + Tier 2 (procedural `.js`) shipped (v1.13.0)
- **Review:** hardened after a 5-lens adversarial review of an earlier draft (see §15 changelog).

## 1. Motivation

kino's motion-graphics system is built on one bet: **motion is a pure function of the current
frame**, so Remotion's headless-Chromium frame-seek renders deterministically. Tier 1 (agent-authored
HTML/CSS bound to kino-set CSS variables) and Tier 2 (procedural `.js` returning HTML per frame) both
honor that bet, and the determinism lint in `src/render/motiongraphic.ts` enforces it (no RAF, timers,
wall-clock/RNG calls, CSS `transition`, SVG SMIL, external `url()`).

Those tiers are **agent-authored** — an LLM writes the design. That is their strength and their ceiling:
they can't deliver organic illustrated motion, complex vector morphs, or designer-crafted logo reveals
that come out of After Effects. **Lottie** fills exactly that gap, and it is the *only* mainstream
animation format that fits kino's determinism model without a sandbox rewrite, because
**`@remotion/lottie` drives the animation off `useCurrentFrame()`** — same frame-seek discipline as the
rest of the pipeline. anime.js / GSAP / Framer Motion are RAF/timeline engines whose native execution
model *is* the lint's denylist; Lottie is deterministic by construction.

The tradeoff: Lottie assets are **brought in** (LottieFiles' free library, AE/Bodymovin exports), not
agent-authored. So Tier 3 *complements* Tiers 1–2 — it does not replace them.

## 2. Decisions locked during brainstorming

| Decision | Choice | Rationale |
|---|---|---|
| Ambition | **Polished Tier-3 feature** | Schema/docs/SKILL/lint/tests — shippable like Tiers 1–2. |
| File format (v1) | **`.json` (Bodymovin) only** | What `@remotion/lottie` consumes directly; no unzip dependency; covers the bulk of LottieFiles. `.lottie` (dotLottie) is a documented follow-on. |
| Brand theming (v1) | **Play as-authored** (no recoloring) | Predictable, ships faster; author picks on-brand assets. Color-token remap is a documented follow-on. |
| Playback mapping | **Stretch the full animation once across the beat** (default); `loop` opt-in plays at native speed | Matches the system's "everything is progress across the beat" model. |
| Expressions | **Reject with a friendly lint error** | Matches the existing determinism-lint ethos; kills both non-determinism and a runtime eval surface. |

## 3. Architecture (Approach A — third source branch)

Lottie rides on the **existing** `MotionGraphicRef` (`source`/`params`/`keyframes`/`triggers` +
one new `loop`, `src/spec/schema.ts:20`). The resolver already dispatches on file extension; we add a
`.json` → Tier 3 branch. Because everything flows through `MotionGraphicRef`, Lottie works in **all
three slots**:

- `kind:"motion"` segments (VO-timed, carry `text`)
- `motionOverlay` on `avatar` segments
- `motionOverlay` on `app` segments

`src/commands/build.ts` routes all three through `resolveMotionGraphic(...)` (lines 243, 250, 256), so
the dispatch is internal. **`KinoVideo.tsx` is unchanged.** `build.ts` needs a **one-line change**: the
`kind:"motion"` call site (line 256) constructs the ref by hand-picking fields, so it must now also
forward `loop: seg.loop`; the two overlay call sites pass the whole `motionOverlay` object, so `loop`
already flows there.

Approaches B (separate `kind:"lottie"` segment + `lottieOverlay` field) and C (transcode Lottie →
procedural `.js`) were rejected: B duplicates the segment/overlay plumbing for no gain; C would mean
reimplementing lottie-web. See §11.

### 3.1 Module boundaries

- **NEW `src/render/lottie.ts`** — fs-free, pure, deterministic (mirrors how `sanitizeMotion.ts` is
  split out so `motiongraphic.ts` stays focused). Exports:
  - `parseLottie(raw: string): { data: LottieData }` — JSON-parse + shape/duration validation; throws friendly errors.
  - `lintLottie(data: LottieData): string[]` — hard determinism/safety violations (empty = clean), same contract as `lintMotionHtml`/`lintMotionJs`.
  - `warnLottie(data: LottieData): string[]` — non-fatal warnings (e.g. opaque background); logged, not thrown.
  - the `LottieData` type.
- **`src/render/motiongraphic.ts`** — `resolveMotionGraphic` grows a **required** extension allowlist
  and a `.json` branch that calls `parseLottie` + `lintLottie` (throw) + `warnLottie` (log).
- **`src/render/props.ts`** — `MotionGraphicProps` gains `lottie?: LottieData` and `loop?: boolean`.
- **`src/spec/schema.ts`** — `motionFields` gains `loop: z.boolean().optional()` (additive; applies to
  all three slots).
- **`src/render/remotion/MotionGraphic.tsx`** — renders `<Lottie>` when `data.lottie` is set;
  otherwise the existing `ShadowHtml` path (html/proc) is unchanged.

## 4. Resolve / dispatch (required extension allowlist)

In `resolveMotionGraphic` (`src/render/motiongraphic.ts`), dispatch on the **lowercased** extension so
`.JSON`/`.JS` from a download don't fall through (this also fixes the pre-existing case-sensitive `.js`
match at line 77):

```
ext = source.toLowerCase()
ext.endsWith(".js")   → Tier 2 (unchanged behavior)
ext.endsWith(".json") → Tier 3 (NEW)
ext.endsWith(".html") → Tier 1 (unchanged behavior)
else                  → throw "motion source must be .html, .js, or .json (got <source>)"
```

The unknown-extension `else` is **required, not optional**: today a non-HTML/JS file silently falls into
the Tier-1 HTML branch (`readFileSync` as utf8 → HTML lint), which for a binary or stray file produces a
baffling `transition is non-deterministic`-style error. Adding `.json` makes that fallback more
surprising, so we close it.

The `.json` branch:

1. `readFileSync` the asset (existing missing-file guard reused).
2. `const { data } = parseLottie(raw)` — throws a friendly error on unparseable JSON, non-Lottie shape, or indeterminable duration.
3. `const violations = lintLottie(data)` — throws `Motion graphic assets/<source>: <violations joined>` on any.
4. `for (const w of warnLottie(data)) console.warn(...)` — non-fatal (e.g. opaque background; see §5.1).
5. Return `{ html: "", lottie: data, loop: ref.loop, ...base }` where `base = { params, keyframes, triggers }`.

`html: ""` follows the Tier-2 convention. `html`, `proc`, and `lottie` are **mutually exclusive**;
exactly one of `proc`/`lottie` is set, or neither (Tier 1). `loop` is carried for every tier (inert for
html/proc).

## 5. Validation + determinism lint (`lottie.ts`)

`parseLottie(raw)`:

- `JSON.parse` inside try/catch → friendly "not valid JSON" on failure.
- **Shape check:** object with the Bodymovin core fields — `v` (version, string), `w` + `h` (numbers),
  `ip` + `op` (in/out point, numbers), **`fr` (frame rate, number > 0)**, `layers` (array). Missing any
  → "not a Lottie animation (expected Bodymovin JSON with v/w/h/fr/ip/op/layers)".
- **Duration guarantee:** require `op > ip` and `fr > 0`; compute `durationInSeconds = (op - ip) / fr`.
  If degenerate → "Lottie has no determinable duration (op must exceed ip, fr must be > 0)". This
  guarantees the renderer's `getLottieMetadata` (which validates the same fields) won't return `null` for
  a file we accepted (see §7.2 null contract).

`lintLottie(data)` returns human-readable violations (empty = clean). The walk is a **full recursive
traversal of every object/array node** in the parsed document (so it reaches `ks`/transforms, effect
values `ef[].ef[].v`, text-animator props, `masksProperties[]`, time-remap `tm`, and **nested precomp
layers** under `assets[].layers[]` — not just top-level property objects):

| Rule | Detection | Message |
|---|---|---|
| **No AE expressions** | A node has own key `"x"` whose **value is `typeof === "string"`** (the JS expression source). | "After Effects expressions aren't allowed — they evaluate JS at render time (non-deterministic + an eval surface). Re-export with expressions baked/removed." |
| **No external/system fonts** | `fonts.list[]` exists with any entry whose `origin`/`fPath`/`fName` indicates a non-embedded face (system or remote, not a `data:`-embedded font). | "external/system fonts aren't allowed — headless Chromium has no guaranteed fonts, so text would render with a host-dependent fallback (non-deterministic). Outline text to shapes, or embed the font." |
| **No external image assets** | An `assets[]` image entry where `e !== 1` **OR** `!String(p).startsWith("data:")`. | "external asset refs don't resolve during render — embed images in the export (base64 data: URI), or remove them." |
| **No embedded SVG payloads** | An embedded image `p` whose `data:` mimetype is `image/svg+xml`. | "embedded SVG image payloads aren't allowed — they bypass HTML sanitization and can carry script. Rasterize to PNG/JPEG, or remove." |
| **No data-driven slots** | A top-level `slots` object, or any `sid` slot-reference field. | "Lottie slots (data-driven theming indirection) aren't supported — flatten the values into the animation." |
| **Size cap** | `Buffer.byteLength(JSON.stringify(data), "utf8")` > `LOTTIE_MAX_BYTES` (3 MB). | "Lottie is too large (<n> MB > 3 MB) — it ships inline in the render inputProps. Simplify or split the animation." |

**Why `x` must be string-typed:** Bodymovin's split-dimension positions (Separate Dimensions on
Position — very common in AE/LottieFiles exports) encode X/Y as sibling keys literally named `"x"`/`"y"`
holding property **objects** `{a,k,ix}`; mask feather is also keyed `"x"` as an object. Only an
**expression** stores a **string** in `x`. Flagging any key named `x` would reject many clean assets.

**Size measure** is the serialized form that actually travels (`JSON.stringify(parsedData)`), not the
on-disk file bytes (which include original whitespace). Per-asset cap; see §6 for the aggregate note.

Audio layers (`ty:6`) and `markers[]` are inert in `@remotion/lottie` rendering and are **allowed**
(documented, not stripped).

### 5.1 Opaque-background warning (overlay occlusion)

The same `MotionGraphic` component renders full-screen `kind:"motion"` beats **and** `motionOverlay`
layered above the avatar/app video (KinoVideo.tsx z6, above avatar z3 / app z4, below captions z8). Many
exports ship an **opaque full-frame solid** (a `ty:1` solid layer sized `w×h` with full alpha) — fine
for a full-screen beat, but as an overlay it **completely occludes** the presenter or app screenshot.
HTML-tier fragments avoid this because they're transparent by construction; a brought-in Lottie is not.

`warnLottie` detects a full-frame opaque `ty:1` solid and emits (non-fatal):
"opaque background detected — fine for `kind:\"motion\"`, but as a `motionOverlay` this will hide the
underlying video. Use a transparent-background export."

It's a **warning, not an error**, because `resolveMotionGraphic` is slot-agnostic (full-screen beats
legitimately have backgrounds). Making it slot-aware (hard-reject only for overlays) is a documented
follow-on. §9 documents that **overlay Lotties must have transparent backgrounds.**

## 6. Props

`src/render/props.ts`:

```ts
// A parsed Lottie (Bodymovin) animation document. Structurally JSON, so it serializes
// cleanly through Remotion inputProps. Validated + linted at resolve time (src/render/lottie.ts).
export type LottieData = Record<string, unknown>;

export interface MotionGraphicProps {
  html: string;            // "" for procedural AND lottie graphics
  proc?: string;           // Tier 2
  lottie?: LottieData;     // Tier 3 (NEW) — the parsed animationData
  loop?: boolean;          // NEW — Lottie playback (inert for html/proc); default false
  params: Record<string, BgParamValue>;
  keyframes: BgKeyframe[];
  triggers: BgTrigger[];
}
```

`MotionGraphicRefInput` (`motiongraphic.ts:60`) gains `loop?: boolean`. The animationData is already
JSON, so it passes through `inputProps` without special handling; the §5 size cap protects the
inputProps payload. **Aggregate note:** multiple Lottie beats in one spec all serialize into one
`inputProps` object; the per-asset cap bounds each, and an aggregate budget guard in `build.ts` is a
documented follow-on if real specs approach the limit.

## 7. Render (`MotionGraphic.tsx`)

**Hook ordering (rules-of-hooks):** the Lottie branch must `return` **after** every existing top-level
hook has run — `useCurrentFrame()`, `useVideoConfig()` (line 59), and the `React.useMemo` for `procFn`
(lines 69–79). Returning earlier would conditionally skip a hook. `buildMotionVars`/`procFn` are inert
for the Lottie branch (executed-then-discarded); short-circuit `procFn` to `null` when `data.lottie` is
set so an empty `Function` isn't compiled.

When `data.lottie` is present, render `<Lottie>` inside the existing `AbsoluteFill`:

```tsx
import { Lottie, getLottieMetadata } from "@remotion/lottie";
// ... inside MotionGraphic, after all hooks ...
const { fps } = useVideoConfig();                 // already destructured at line 59
if (data.lottie) {
  const loop = data.loop ?? false;                // first-class boolean field — no coercion
  const meta = getLottieMetadata(data.lottie);    // { width, height, fps, durationInFrames, durationInSeconds } | null
  // Stretch the full animation once across the beat. Docs: "A higher number is faster. Default: 1."
  // → play once across a longer beat = SLOW DOWN, so rate = naturalSeconds / beatSeconds.
  // Computed in SECONDS so a non-30fps asset isn't mis-scaled against the 30fps composition clock.
  const beatSeconds = durationFrames / fps;
  const playbackRate =
    !loop && meta && beatSeconds > 0 ? meta.durationInSeconds / beatSeconds : 1;
  return (
    <AbsoluteFill>
      <Lottie
        animationData={data.lottie}
        loop={loop}
        playbackRate={playbackRate}
        preserveAspectRatio="xMidYMid meet"   // contain, centered (documented prop since v4.0.105)
        style={{ width: "100%", height: "100%" }}
      />
    </AbsoluteFill>
  );
}
```

- **Sizing/fit:** default **contain, centered** (`preserveAspectRatio="xMidYMid meet"`, a valid
  documented `<Lottie>` prop) so a non-9:16 asset letterboxes cleanly. The letterbox derives purely from
  the `AbsoluteFill` dimensions, so **3:4 (1080×1440) and 9:16 (1080×1920) behave identically** — no
  format-specific code. A `fit:"cover"` param is a follow-on.
- **Determinism:** `@remotion/lottie` reads `useCurrentFrame()` internally; no per-frame imperative
  driving is needed (unlike `ShadowHtml`, which sets CSS vars each frame).
- **Caption clearance:** the Lottie path **cannot** honor `captionBottom` in v1 (there's no
  kino-controlled internal layout in a brought-in asset). A full-frame Lottie may draw through the
  lower-third caption band; captions win on z-order (z8) but the Lottie's focal content can sit behind
  the caption text. §9 recommends caption-safe assets. `captionBottom` stays wired for the HTML path.
- **Params:** the only Lottie control is `loop` (first-class boolean field). The
  `--frame`/`--progress`/keyframe machinery is inert for Lottie (it has its own internal timeline).

### 7.1 Playback mapping (pinned)

- **Default (`loop:false`):** the animation plays **once**, time-scaled so its full duration spans the
  beat. The formula is **pinned, not deferred**:
  `playbackRate = meta.durationInSeconds / (durationFrames / fps)` — natural seconds over beat seconds.
  Remotion docs state `playbackRate` is "the speed of the animation; a higher number is faster"
  (https://www.remotion.dev/docs/lottie/lottie), so a beat **longer** than the asset gives `rate < 1`
  (slower) and a **shorter** beat gives `rate > 1` (faster). The inverse (`beat / natural`) is wrong.
- **fps normalization is mandatory:** `getLottieMetadata().durationInFrames` is in the Lottie's
  **native** fps ("the duration in frames, if the fps from this object is used",
  https://www.remotion.dev/docs/lottie/getlottiemetadata; example `{ fps: 29.97…, durationInFrames: 90 }`),
  while `durationFrames` is in the **30fps** composition clock (`build.ts:274`, `KinoVideo.tsx`). Using
  `meta.durationInSeconds` (and `fps` from `useVideoConfig()`, never a literal `30`) keeps both on the
  same clock. A 60fps 2s asset and a 2s beat then correctly yield `rate = 1`.
- **`loop:true`:** `playbackRate = 1`, `loop = true` — native speed, repeats to fill the beat.

### 7.2 `getLottieMetadata` null contract

`getLottieMetadata` returns `null` if metadata can't be parsed. Because §5's `parseLottie` validates the
same `fr`/`ip`/`op`/`w`/`h` fields and rejects degenerate files, an accepted file should always yield
metadata. As a belt-and-suspenders guard, the §7 ternary falls back to `playbackRate = 1` (native speed)
when `meta === null`, with a frame-0 `console.warn` (mirroring `MotionGraphic.tsx:98`). §10 covers this
branch.

## 8. Dependency

Add `@remotion/lottie` to `package.json` dependencies with the **same caret range as the other
`@remotion/*` packages (`^4.0.0`)** — Remotion packages must move in lockstep, and matching the caret
keeps it in sync with the floating `remotion`/`@remotion/bundler`/`@remotion/renderer` (currently
resolving to 4.0.477). It brings `lottie-web` transitively. No change to the `files` array (the renderer
bundle already ships `src/render/remotion`).

## 9. Spec contract / authoring

Additive schema change: `motionFields` gains `loop: z.boolean().optional()` (applies to motion segments
and both overlay slots). Authors reference a Lottie like any motion graphic; `loop` is a **sibling of
`source`**, not a param:

```json
{ "kind": "motion", "source": "motion/confetti.json", "text": "We just shipped it." }
```
```json
{ "kind": "app", "asset": "...", "text": "...", "caption": "...",
  "motionOverlay": { "source": "motion/sparkle.json", "loop": true } }
```

Assets live in `assets/motion/*.json` alongside `.html`/`.js`. Authoring rules to document:
- **Overlay Lotties must have transparent backgrounds** (§5.1) — an opaque export hides the avatar/app.
- Prefer **caption-safe** assets (keep focal content clear of the lower third) — kino can't reflow a
  brought-in Lottie (§7).
- Text should be **outlined to shapes or use an embedded font** — external/system fonts are rejected (§5).

## 10. Testing

New `tests/lottie.test.ts` (validator/lint, pure) + additions to the render-motion suite.

**`parseLottie` / `lintLottie` / `warnLottie` (unit, fast):**
- valid minimal Lottie → parses, zero violations
- malformed JSON → friendly parse error
- valid JSON but missing `layers`/`w`/`h`/`fr`/`ip`/`op` → "not a Lottie animation"
- degenerate duration (`op <= ip` or `fr <= 0`) → duration error
- **expression false-positive guard:** split-dimension position `{ x:{a:0,k:[…],ix:3}, y:{a:0,k:[…],ix:4} }` → **CLEAN**
- expression positive: property with `x:"$bm_rt=…"` (string) → violation
- expression in a nested precomp (`assets[].layers[]`) and in an effect value (`ef[].ef[].v`) → violation (locks recursion depth)
- external/system font in `fonts.list[]` → violation
- external image asset (`e:0`, or non-`data:` `p`) → violation; embedded `e:1` `data:image/png` → CLEAN
- embedded `data:image/svg+xml` payload → violation
- top-level `slots` / `sid` reference → violation
- oversized serialized JSON (> cap) → size violation
- opaque full-frame `ty:1` solid → `warnLottie` returns the overlay warning (and `lintLottie` does NOT reject)

**`resolveMotionGraphic` (unit):**
- `.json` source → `MotionGraphicProps` with `lottie` set, `html === ""`, `proc` undefined, `loop` forwarded
- `.json` with a lint violation → throws `Motion graphic assets/<source>: …`
- unknown extension (e.g. `motion/x.png`) → throws "motion source must be .html, .js, or .json"
- uppercase `.JSON` → dispatches to Tier 3 (case-insensitivity)

**Render (Remotion, mirrors `tests/render-motion.test.ts`):**
- Use a tiny hand-authored test Lottie whose **native fps differs from the composition fps** (e.g.
  `fr:60` in the 30fps comp) so fps-normalization is actually exercised.
- **MID-beat assertion (pins direction + rate):** at frame `durationFrames/2` the animation is ~50%
  through and explicitly **not** already at end-state. (Last-frame-only can't distinguish a correct
  stretch from an inverted/too-fast rate, since a non-looping Lottie freezes its final frame either way —
  so mid-beat is the real oracle; keep last-frame = end-state as a secondary check.)
- **Determinism:** two renders of the same frame are identical; optionally render the last frame via two
  seek orders (0→last vs direct-to-last) and assert equality (seek-independence for parallel rendering).
- `loop:true` renders without error.
- `meta === null` fallback branch renders at native speed without throwing.

A small hand-authored demo Lottie (a few KB, non-30fps) lives under `examples/motion-flex/` or `assets/`
for the render test and as a usage example.

## 11. Rejected alternatives

- **B — separate `kind:"lottie"` segment + `lottieOverlay` field.** Explicit, but duplicates the
  segment + overlay plumbing and loses the `MotionGraphicRef` reuse that gives all three slots cheaply.
- **C — transcode Lottie → procedural Tier-2.** Would require reimplementing lottie-web to emit SVG per
  frame. Not viable.

## 12. Documented follow-ons (not built now)

- **`.lottie` (dotLottie)** support — needs an unzip step + asset extraction at resolve time.
- **Color-token remap / brand theming** — map source hex colors → brand palette tokens at resolve time.
- **Slot-aware overlay lint** — hard-reject (not just warn) opaque backgrounds when the asset is used as
  a `motionOverlay` (requires passing slot context into `resolveMotionGraphic`).
- **`speed` override + per-marker segment playback** (Lottie markers), **`fit:"cover"`** sizing param.
- **Aggregate inputProps budget** guard in `build.ts` for specs with many Lottie beats.

## 13. Files touched

| File | Change |
|---|---|
| `src/render/lottie.ts` | **NEW** — `parseLottie`, `lintLottie`, `warnLottie`, `LottieData`, `LOTTIE_MAX_BYTES` |
| `src/render/motiongraphic.ts` | required lowercased extension allowlist + `.json` dispatch branch; `MotionGraphicRefInput.loop?` |
| `src/render/props.ts` | `MotionGraphicProps.lottie?: LottieData` + `loop?: boolean` |
| `src/spec/schema.ts` | `motionFields.loop: z.boolean().optional()` (additive) |
| `src/commands/build.ts` | **one line** — forward `loop: seg.loop` at the `kind:"motion"` call site (line 256); overlays already pass the whole ref |
| `src/render/remotion/MotionGraphic.tsx` | `<Lottie>` render path (after all hooks; `procFn` short-circuited for Lottie) |
| `package.json` | add `@remotion/lottie: ^4.0.0` |
| `src/commands/motion.ts` | Tier-3 section in `motionHelpText()` |
| `docs/motion-graphics.md`, `docs/spec-reference.md` | Tier-3 authoring docs (incl. transparent-bg + caption-safe + font rules) |
| `skills/video-production/SKILL.md` (+ `reference.md`) | Tier-3 note |
| `tests/lottie.test.ts` (+ render-motion additions) | tests |
| `examples/` or `assets/` | demo `.json` asset (non-30fps) |

`src/render/remotion/KinoVideo.tsx` is **unchanged** (`durationFrames` + `captionBottom` already flow to
`MotionGraphic`).

## 14. Open risks (residual)

- **Opaque-overlay occlusion** is mitigated by a warning + docs, not a hard reject, because the resolver
  is slot-agnostic in v1 (§5.1; slot-aware reject is a follow-on).
- **Caption overlap** for full-frame Lotties is mitigated by docs (caption-safe assets), not layout
  control (§7).
- **lottie-web expression module** — whether or not the `@remotion/lottie` build evaluates expressions,
  §5's reject rule is correct either way (determinism guard + eval-surface defense), so behavior is
  well-defined.

## 15. Changelog (review hardening)

Earlier draft → this version, after a 5-lens adversarial review:
- **Pinned** the `playbackRate` direction (`natural/beat`, "higher = faster") instead of deferring it to
  a test, and made it **fps-normalized in seconds** (was a frame ratio mixing native vs composition fps).
- **`loop`** moved from a `params` boolean (which fails Zod `number|string`) to a first-class optional
  schema field; removed the undefined `toBool`/`computeStretchRate` helpers from the render snippet.
- **Expression lint** narrowed to string-typed `x` (was: any key `x`, a false positive on
  split-dimension positions); walk specified as full recursion.
- Added **font** rule (external/system fonts = host-dependent fallback = non-determinism), tightened the
  **image-asset** rule, added **embedded-SVG** and **slots** rules.
- Added **opaque-background overlay warning** (§5.1) + transparent-bg authoring requirement.
- Promoted the **extension allowlist to required** + case-insensitive dispatch.
- **Test oracle** now requires a **mid-beat** assertion and a **non-30fps** test asset (last-frame-only
  couldn't pin direction/rate).
- Size measure specified as serialized `JSON.stringify` bytes; `getLottieMetadata` null contract defined;
  hook-ordering note added; dependency wording corrected to caret-range (not exact pin).
