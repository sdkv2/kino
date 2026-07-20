# Markdown brands (optional) — design

> Status: approved 2026-06-17. Replaces the required, zod-validated `brands/<name>/brand.json` with an
> optional `brands/<name>/brand.md` (YAML frontmatter + free-form guidelines). Distinct from the open
> Tier-2 PR; lands on its own branch.

## Goal

Make brands **optional** and express them as a **markdown file** — YAML frontmatter for the structured
values kino's render needs, and a free-form body of styling/guidelines the driving agent reads. Remove
the "mandatory lock": `kino build` should work with no brand at all (sensible kino defaults), and a
faceless build should never demand an avatar look.

## Scope

**In scope:**
- `brands/<name>/brand.md` = optional YAML frontmatter + markdown guidelines body.
- A `DEFAULT_BRAND` so any missing field (or a missing brand entirely) resolves to kino defaults.
- Lazy voice/look validation (only require what the chosen provider / real build actually needs).
- A `kino brand [name]` discovery command (list brands; print a brand's frontmatter + guidelines).
- Docs (SKILL + README) updated.

**Out of scope / breaking:**
- `brands/<name>/brand.json` is **no longer read** (per decision). Existing JSON brands (e.g. Acme)
  must be converted to `brand.md`; not done here.
- No change to the spec schema, the render composition (beyond skipping an empty disclosure), or the
  motion-graphics / Tier-2 work.

## `brand.md` format

Located at `workspaceRoot/brands/<name>/brand.md`. Optional YAML frontmatter, then a free-form body.

```markdown
---
name: kino
colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" }
font: Sora
defaultVoice: EXAVITQu4vr4xnSDxMaL
captionMode: words
background: aurora
---
# kino — brand guidelines

- Voice: confident, plain-spoken; short sentences.
- Look: dark night background, mint→green gradients, gold for accents only.
- Captions: word-by-word; emphasise the product name and the payoff word.
- Avoid: exclamation marks, guaranteed-outcome claims.
```

**Frontmatter is all-optional** and accepts any subset of today's brand fields: `name`, `colors`
(`night`/`mint`/`green`/`white`/`gold`), `font`, `labelFont`, `captionStyle` (`fontSize`/`strokeWidth`/
`background`), `disclosure`, `facelessDisclosure`, `logo`, `logoSize`, `logoPosition`, `background`,
`backgroundColors`, `backgroundIntensity`, `facelessBackdrop`, `backgroundComponent`, `captionMode`,
`bannedPhrases`, `defaultVoice`, `defaultLook`, `defaultProvider`, `avatarImage`, `hedraModelId`,
`replicateModel`/`replicateImageField`/`replicateAudioField`/`replicateInput`, `voiceAliases`,
`lookAliases`. The markdown **body** is never parsed by kino — it's guidance for the authoring agent.

A `brand.md` with **no frontmatter** (pure guidelines) is valid: every value falls back to the default.

## Defaults & optionality

A `DEFAULT_BRAND` constant supplies kino's house values:

| Field | Default |
|---|---|
| `colors` | `{ night:#0b1020, mint:#80e2b4, green:#0c8d64, white:#ffffff, gold:#d99a20 }` |
| `font` | `Helvetica, "Helvetica Neue", Arial, sans-serif` |
| `captionStyle` | `{ fontSize: 74, strokeWidth: 9 }` |
| `captionMode` | `phrase` |
| `background` | `glow` |
| `name` | `""` |
| `disclosure` / `facelessDisclosure` | **`""` (none — only shown if a brand/spec sets it)** |
| `bannedPhrases` | `[]` |
| `voiceAliases` / `lookAliases` | `{}` |

`loadBrand(name)` reads `brands/<name>/brand.md`, splits frontmatter from body, parses the frontmatter
with `yaml`, validates it against a **relaxed (all-optional) zod schema**, then deep-merges it over
`DEFAULT_BRAND` (colors merged field-by-field) → a fully-populated `Brand`. **Downstream render code is
unchanged** — it still receives a complete `Brand`.

`prepare` (build) no longer throws "No brand": if neither `spec.brand` nor a project brand is set, it
uses `DEFAULT_BRAND` directly (no file read). If a brand name is set but the `.md` is missing → a clear
"brand not found" error.

**Disclosure:** default `""`. The composition renders the disclosure only when it's non-empty (a small
guard where the disclosure text is drawn), so the absence is clean — no placeholder text.

## Voice / look validation (the "mandatory lock" fix)

Move the eager `resolveVoiceLook` check out of unconditional `validateSpec`:
- **Look** (`avatarLook`/`defaultLook`) is required **only** when the resolved provider is not `none`
  (i.e. an avatar is actually rendered). Faceless never needs a look.
- **Voice** is required **only** for a real (non-`mock`) build — resolved from frontmatter
  `defaultVoice`/`voiceAliases` or `spec.voice`. Missing → a clear error ("set a voice: spec.voice or
  brand defaultVoice"). Mock builds (silent VO) need no voice.

This is what lets a brandless / look-less faceless build run.

## Discovery — `kino brand [name]`

- `kino brand` (no arg) — list brands found under `brands/` (the `<name>` dirs containing a `brand.md`).
- `kino brand <name>` — print the resolved frontmatter (as a readable summary) **and** the guidelines
  body, so the driving agent can read the styling rules before authoring a spec.

Registered in `src/cli.ts`; implemented in `src/commands/brand.ts`. SKILL/README note that brands are
optional markdown and to run `kino brand <name>` for guidelines.

## Architecture / files

- **`src/config/brand.ts`** — rewrite `loadBrand` to read `brand.md`: split frontmatter/body, `yaml`-parse,
  validate via a relaxed `BrandFrontmatterSchema` (all fields optional), deep-merge over `DEFAULT_BRAND`.
  Export `DEFAULT_BRAND`, the resolved `Brand`, and (new) the guidelines `body` string. The `Brand` type
  is unchanged (still fully-populated after merge).
- **`src/commands/build.ts`** (`prepare`) — brand resolution becomes optional (default to `DEFAULT_BRAND`
  when none); drop the "No brand" throw; load `brand.md` when a name is set.
- **`src/spec/validate.ts`** — remove the unconditional voice+look assertion; add the lazy checks above
  (called from `prepare` once the provider/mock are known).
- **`src/render/remotion/*`** — guard the disclosure render to draw nothing when the string is empty.
- **New `src/commands/brand.ts`** + **`src/cli.ts`** — the `kino brand` command.
- **`package.json`** — add `yaml`.
- **Docs** — `skills/video-production/SKILL.md`, `README.md`, and `kino init` scaffolding (emit a starter
  `brand.md` instead of `brand.json`).

## Testing

- **Frontmatter parse + merge:** a `brand.md` with partial frontmatter (e.g. only `colors.night` + `font`)
  → resolved `Brand` has those values and defaults elsewhere.
- **Pure-guidelines md** (no frontmatter) → all defaults; `body` captured.
- **No brand at all:** `prepare` resolves `DEFAULT_BRAND` and does not throw.
- **Lazy validation:** faceless `--mock` build with no voice/look succeeds; a real build with no voice
  anywhere throws the clear voice error; a `heygen` build with no look throws the look error.
- **Empty disclosure:** a render still produces a frame and draws no disclosure text (assert via a render
  still / unit on the guard).
- **`kino brand`:** lists brand dirs; prints a brand's frontmatter summary + body.

## Open items

- Existing `brand.json` projects stop working until converted to `brand.md` (intended; conversion not in
  scope here). `kino init` will scaffold `brand.md` going forward.
- The relaxed schema still validates *types* (e.g. `colors.mint` must be a string, `captionMode` ∈
  `phrase|words`) so a malformed frontmatter fails with a clear zod error rather than silently.
