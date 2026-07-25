---
name: adversarial-critique
description: >-
  Adversarial visual QA for kino short-form ads. Spins a read-only subagent that
  inspects each storyboard/build still for overlap, overflow, bad positioning, and
  legibility. Use after `kino storyboard`, after `kino frames` on a real build, or
  when the user asks for a visual critique / layout review / adversary pass.
---

# Adversarial visual critique

Companion to `video-production`. That skill authors + builds.
**This skill owns the layout QA gate** — fresh subagent eyes, not the author self-checking a montage.

## When

- After a storyboard you intend to keep (mandatory before calling it done)
- After a real build when captions/overlays depend on VO timing
- On user request: "critique", "adversary", "layout review", "check overlap"

Do **not** self-review the contact sheet alone.

## Parent agent (you)

1. **Produce per-frame stills** (not only the montage):
   - Pre-build: `kino storyboard <spec>` → `out/<title>/stills/sb-*.png` (+ `storyboard.png`)
   - **Motion / Lottie / typed-UI beats:** also `kino still <spec> --around <t>` per animated beat
     (sheet of N frames around the interesting moment). Storyboard midpoints miss typewriter grain,
     Lottie phase, and camera push — attach those `*-around-*.png` sheets to the critique.
   - Post-build: `kino frames <mp4> --count <N>` (or `--every 1`) → `…/frames/*.png`, **plus**
     `kino frames <mp4> --around <t>` on each motion/Lottie/typed beat after real VO
2. **Spin a read-only subagent** (`generalPurpose` — no file edits). Give it:
   - Absolute path to the spec
   - Absolute paths to **every** still (prefer `sb-*.png` / frame PNGs **and** `--around` sheets;
     tiled `storyboard.png` alone is not enough)
   - The subagent brief below (paste verbatim, fill paths)
3. **Fix the spec** from findings (layout/copy/position only). Do **not** patch `src/render/**`
   unless the user confirms a renderer bug.
4. Re-storyboard. Re-run this skill if findings were 🔴/🟠.
5. Ship only when critique returns no 🔴/🟠 (or user explicitly accepts leftovers).

## Split up the frames

- Storyboard default = **2 stills per beat** (composition + **·full**). Critique **·full** hardest —
  overflow and `texts` collisions show there.
- Animated beats: critique the `--around` sheet as a sequence (does text type? does Lottie move?
  does the camera push?). Flag 🟠 if motion was only checked at a single midpoint.
- Post-build: `--count` ≈ 2× beat count, or `--every 1`, so mid-beat states aren't skipped —
  still run `--around` on motion/typed beats.
- Never rely on eyeballing only `storyboard.png` at thumbnail size — open each still at full size
  via the image Read tool.

## Subagent brief (paste / adapt)

```
You are an adversarial visual QA reviewer for a short-form vertical (9:16) ad.
Read-only: do NOT edit files. Do NOT praise. Find problems.

Inputs:
- Spec: <absolute path to spec.json>
- Frame stills (inspect EACH with the image Read tool — open every file, not just the montage):
  <absolute paths to stills, one per line>

Task:
1. Open each still individually. Note beat label / filename.
2. Hunt major layout defects. Priority order:
   🔴 Overlap / collision — caption vs texts overlay, kicker, logo, CTA, motion graphic, or subject
   🔴 Overflow — text clipped by frame edge, wrapping into unreadability, cut off at sides
   🔴 Frozen motion — on an --around sheet, typed UI / Lottie / counter / camera looks identical
      across tiles (animation not driving, wrong stretch, opaque Lottie covering the beat)
   🟠 Under-animated motion — sheet changes only via a single opacity fade, or entrance finishes
      early then holds dead; no stagger / idle life / speech punch / camera (see video-production
      § Make motion graphics move — need ≥3 motion layers)
   🟠 Dead tail — multi-step UI (pipeline/tiles) lands in the first third then freezes while VO
      continues; or steps light ahead of / behind the spoken nouns (should gate on env.words)
   🟠 Copy/VO mismatch — on-screen chip/label nouns ≠ spoken words (e.g. "compose" vs "motion")
   🟠 Bad positioning — caption pinned to top edge; CTA left as a tiny lower-third subtitle on empty
      mesh (should be centered end card with `cta: true`); elements stacked in the same band.
      **Platform safe zones (`still --platform`) are a guide, not a mandate** — flag only when
      *important* content (hook, CTA, hero caption, kicker, primary claim) sits where feed chrome
      would obscure it. Non-critical chrome (tab bars, nav icons, decorative dock, secondary labels)
      may sit in the TikTok/Reels UI bands by design.
   🟠 Legibility — light text on light subject, missing/weak caption backplate over busy footage,
      active-word colour that disappears into the ground
   🟠 Loop seam — for looping ads: first≠last ready-state, fade-from/to black, or animated mesh
      bg drift between ends (see video-production § Seamless loops)
   🟠 Dead zone — overlay a 3×3 grid on the frame; name which cells hold real content. If a full
      row or column of cells is empty AND it isn't a deliberate rest plane (background wash,
      safe-zone margin), flag it. A contiguous background band ≥25% of frame height inside the
      content area is a dead zone (e.g. gap between a title bar and a checklist that sank to the
      lower half). Fix: center the content group in its container, or shrink the container to fit.
   🟠 Off-balance — estimate the optical center of mass of all non-background content. If it sits
      outside the middle 40% band (bottom-heavy, top-glued, dumped to one side) with no
      counterweight (kicker, mark, deliberate negative space), flag it.
   🟠 Misalignment — sibling elements (list rows, chips, steps, icon+label pairs) whose left/center
      edges or baselines don't share one axis; ragged indents. Fix: one shared alignment axis per
      repeated group.
   🟠 Container void — a card/window whose content fills <50% of its own area; the shell is
      oversized for its contents. Fix: size the shell to the content, or fill it.
   🟡 Hierarchy noise — too many competing text layers; emphasis glow on many words; jittery
      per-beat y/scale that would read as "jumping" across adjacent stills
3. Framing — dead space, imbalance, misalignment, container void — is a DEFECT, not taste; hunt
   it with the grid procedure above. Ignore only palette/vibe preferences that cause no measurable
   defect. Ignore audio (except note if a looping cut has an obvious bed fade-to-silence at the end).

Return ONLY a finding list, one line each:
`file:beat: <emoji> <severity>: <what's wrong>. <concrete fix hint for the spec>.`
If truly clean: `OK — no major layout issues.`
```

## Defect checklist (quick)

| Sev | Look for |
|---|---|
| 🔴 | Caption overlapping `texts` / kicker / logo / CTA / motion |
| 🔴 | Text cut off at frame edge or crushed by wrap |
| 🔴 | Frozen motion on `--around` sheet (typed UI / Lottie / counter / camera identical across tiles) |
| 🟠 | Under-animated motion (opacity-only / early freeze / no stagger / no idle life / no VO punch) |
| 🟠 | Dead tail / steps not word-synced; on-screen nouns ≠ VO nouns |
| 🟠 | CTA as tiny lower-third on empty mesh (should be centered end card with `cta: true`) |
| 🟠 | Caption glued to top edge; stacked bands; **important** content hidden by feed chrome (see platform guide below) |
| 🟠 | Unreadable over bright footage / no backplate |
| 🟠 | Motion/Lottie beat only reviewed at a single midpoint (no `--around` sheet) |
| 🟠 | Loop seam broken (fade ends, mesh drift, first≠last ready poster) |
| 🟠 | Dead zone (empty grid row/col; background band ≥25% frame height inside content area) |
| 🟠 | Off-balance (center of mass outside middle 40%; bottom-heavy / top-glued / one-side dump) |
| 🟠 | Misalignment (list rows / chips / icon+label off a shared axis; ragged indent) |
| 🟠 | Container void (card/window content fills <50% of its own area) |
| 🟡 | Too many text layers; multi-word emphasis; position jitter across beats |

**Platform safe zones (`still --platform tiktok|reels|shorts`):** overlay is a **composition guide**,
not a hard keep-out. Protect hooks, CTAs, hero captions, kickers, and primary claims from chrome that
would hide them. **Non-important UI** (bottom tab bars, nav icons, decorative docks, secondary labels)
is allowed in the shaded bands — do not flag 🟠 solely because chrome overlaps those elements.

## After findings

Parent maps each line → spec edit (`caption` length, `texts` position/size, `cta: true`,
`captionKeyframes` only when dodging a bright subject, `captionStyle.background`, drop competing
overlays). Motion/typed fixes → re-run `kino still --around` on that beat, then storyboard + this skill.
