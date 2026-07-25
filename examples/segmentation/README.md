# Segmentation region-shader example

Proves the mask→dual-shader split: a subject shader (red) where the mask covers
the object, a background shader (green) everywhere else.

Drop these into a kino project, then:

```bash
# a fixture asset: blue disc on orange (stand-in for real footage)
ffmpeg -f lavfi -i "color=c=orange:s=1080x1920" -frames:v 1 \
  -vf "geq=r='if(lt(pow((X-540)/300,2)+pow((Y-960)/380,2),1),40,255)':g='140':b='20'" \
  assets/segdemo/subject.png

# a mock mask (no Mac/model needed) — real use: drop --backend mock for CoreML
kino segment assets/segdemo/subject.png --prompt "the disc" --backend mock --out segdemo-mask

# render one frame
kino still specs/region-smoke.json --at 1
```

Expected: a red ellipse (subject region) on green (background region). Swap the
two `.frag` bodies for any ShaderToy-style `mainImage` shaders. See
`docs/segmentation.md`.

## Cross-region glass

`cross-region-glass.json` + `region-glass.frag` (subject) + `region-tint.frag` (background):
tracked liquid glass that refracts **its own background region** rather than the raw plate. The
background here is a real treatment (crushed to cold blue), which is exactly the case where
refracting `uTex0` would show the untreated footage through the glass — a hole punched to a
different image. Same commands as above with the spec name swapped:

```bash
kino still specs/cross-region-glass.json --at 1.2
```

Expected: the subject reads as glass — invisible except for the bands bending through it and a
bevel highlight riding the silhouette. See `docs/segmentation.md` § Cross-region sampling.

## Cutout compositing (a different clip behind the subject)

`cutout.json`: two tracked zebras cut off their own grassy plate and dropped onto an unrelated
clip. No `.frag` at all — `masks` + `backdrop` is the whole spec, because with a backdrop bound the
background region's passthrough IS the backdrop, cover-fit.

Needs a two-object video mask and any second clip. With `projects/segtest`'s assets in place:

```bash
# assets/frag/zebras.mp4 + assets/masks/zebco (a real 2-object CoreML mask), and any clip at
# assets/pexels/rain-glass.mp4 — the backdrop's aspect need not match the beat's.
kino build specs/cutout.json --mock
```

Expected: both zebras over the other clip, and the backdrop **moving** (it routes through the
per-beat `/vframes` pipeline, not a `<video>` seek).

`region-erode2.frag` is the edge remedy: used as each mask's `subject`, it hands the outermost ~2px
of the silhouette back to the backdrop, which clears the olive rim real footage bleeds in from its
original background. It costs ~2px of mane detail — look at both before choosing. See
`docs/segmentation.md` § Cutout compositing.
