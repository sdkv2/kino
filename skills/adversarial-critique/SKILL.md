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
   🟠 Bad positioning — caption pinned to top edge; CTA left as a tiny lower-third subtitle on empty
      mesh (should be centered end card with `cta: true`); elements stacked in the same band;
      unsafe margin to TikTok/Reels UI (top/right/bottom)
   🟠 Legibility — light text on light subject, missing/weak caption backplate over busy footage,
      active-word colour that disappears into the ground
   🟡 Hierarchy noise — too many competing text layers; emphasis glow on many words; jittery
      per-beat y/scale that would read as "jumping" across adjacent stills
3. Ignore taste/brand vibes unless they cause a defect above. Ignore audio.

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
| 🟠 | CTA as tiny lower-third on empty mesh (should be centered end card with `cta: true`) |
| 🟠 | Caption glued to top edge; stacked bands; platform UI collision zone |
| 🟠 | Unreadable over bright footage / no backplate |
| 🟠 | Motion/Lottie beat only reviewed at a single midpoint (no `--around` sheet) |
| 🟡 | Too many text layers; multi-word emphasis; position jitter across beats |

## After findings

Parent maps each line → spec edit (`caption` length, `texts` position/size, `cta: true`,
`captionKeyframes` only when dodging a bright subject, `captionStyle.background`, drop competing
overlays). Motion/typed fixes → re-run `kino still --around` on that beat, then storyboard + this skill.
