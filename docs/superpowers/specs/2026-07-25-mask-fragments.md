# Mask fragments: characterised, and why no filter shipped

`docs/superpowers/specs/2026-07-24-gpu-validation.md` §4 found that SAM's real masks are not one
connected blob per object, and that per-object region shaders now *rim* every component — turning a
barely-noticeable colour speck into a deliberate-looking graphic element. It proposed a
minimum-area connected-component filter in the runner, and deliberately did not implement one,
because "a genuinely detached limb or a subject split by occlusion is also a small component".

This run went and measured that. **The answer is that the detached limbs are not a hypothetical
edge case — they are most of the population.** No filter shipped. Nothing in `src/` or `scripts/`
changed.

## TL;DR

- The size distribution is a **continuum, not bimodal**. Largest empty span anywhere in the pooled
  distribution is **0.42 decades**; there is no gap to put a threshold in.
- Components a **2%** threshold (the one §4 suggested) would delete include a zebra's **leg** and
  **haunch**, a person's **hand**, and the sliver of a man's body still visible past the pillar
  occluding him. At **5%** it also takes both zebras' **tails**.
- **Every** threshold tested destroys real signal. Even 0.1% — twenty times smaller than §4's —
  deletes 53 real components, and that count is a floor (§3).
- **Temporal persistence does not rescue it either.** Real and stray track-length distributions
  overlap heavily (stray p90 = 50 frames, the whole clip).
- The artifact is **footage-dependent**, not universal: on clean-background footage it is already
  near zero (1 stray component in 50 frames), so the population a filter would target barely exists
  on the clips where masks are easy.
- Bonus: painter's-order overlap is **still** unexercised. Zero overlapping pixels across 148 frames
  of three two-subject clips, including two people in a full embrace.

## What was measured

Five 2s clips at 1280x720, chosen to stress different failure modes, all through
`kino segment --backend cuda` (`scripts/sam_runner_cuda.py`, invoked with the exact flags
`src/segment/cuda.ts` passes — that file is a thin wrapper that only resolves the venv Python).
Rented an RTX A4000 on vast.ai; instance destroyed after the masks were pulled, all analysis local.

| clip | Pexels | window | prompt | obj | frames | stress case |
|---|---|---|---|---|---|---|
| `zebras` | 37425597 | 0–2s | zebra | 2 | 50 | cluttered / camouflaged — the §4 case |
| `studio` | 5233469 | 0–2s | woman | 1 | 50 | clean background |
| `pillar` | 8511939 | 26.5–28.5s | person | 1 | 50 | walks behind a column: splits, then vanishes |
| `hug` | 6570474 | 2–4s | person | 2 | 50 | two subjects physically overlapping |
| `dogs` | 10774275 | 1–3s | dog | 2 | 48 | clean snow bg, two subjects, thin legs/tails |

`zebras/mask.mp4` came out **238,907 bytes**, against the "238 KB" §4 recorded — the same artifact,
reproduced, not a lookalike.

Components are labelled **8-connected** (§4's baseline used `scipy.ndimage.label`'s default, which
is 4-connected; 8 merges diagonal touches into the main blob and so counts strays *conservatively*).
Sizes are normalised to the largest component of that object on that frame — absolute pixel
thresholds are resolution-dependent and could never ship.

| clip | components | of which non-largest |
|---|---|---|
| `zebras` | 334 | 234 |
| `studio` | 51 | 1 |
| `pillar` | 63 | 15 |
| `hug` | 265 | 165 |
| `dogs` | 104 | 8 |

Note `studio` and `dogs` already: **1 and 8** non-largest components. Clean footage barely
fragments at all.

## 1. Size distribution — continuum

Pooled non-largest components, n=423, binned by ratio to the object's own main blob:

```
    [0       ,1e-05   )    33 ###########################
    [1e-05   ,3e-05   )    67 ########################################################
    [3e-05   ,0.0001  )    71 ############################################################
    [0.0001  ,0.0003  )    44 #####################################
    [0.0003  ,0.001   )    34 ############################
    [0.001   ,0.003   )    29 ########################
    [0.003   ,0.01    )    31 ##########################
    [0.01    ,0.02    )    20 ################
    [0.02    ,0.03    )     3 ##
    [0.03    ,0.05    )     7 #####
    [0.05    ,0.1     )    22 ##################
    [0.1     ,0.2     )    11 #########
    [0.2     ,0.3     )     1
    [0.3     ,0.5     )    10 ########
    [0.5     ,0.8     )    34 ############################
    [0.8     ,1.0001  )     6 #####
```

Quantiles: p50 `0.000264`, p75 `0.012`, p90 `0.487`, p95 `0.675`, p99 `0.876`, max `0.9996`.

**Largest empty span in log10(ratio): 0.42 decades** (0.000002 → 0.000006, down in the single-pixel
noise). Above that the distribution is populated continuously across five decades. There is no
bimodal gap, and therefore no principled place to put a threshold.

The `zebras` clip *alone* looks deceptively separable — its non-largest components all sit below
0.05, so any threshold in 0.05–1.0 would have cleaned it perfectly. That is exactly the trap:
the zebras never genuinely split. `pillar` and `hug` do, and they fill the whole range.

## 2. What the small components actually are

Every candidate below was cropped out of the source footage and looked at, rather than inferred
from its size. Sizes are in mask pixels at 1280x720.

| clip | frame | size | ratio | what it is | eaten at |
|---|---|---|---|---|---|
| `zebras` | 5 | 4069 | 0.042 | **a zebra's tail** | 5% |
| `zebras` | 2 | 2809 | 0.045 | **the other zebra's tail** | 5% |
| `zebras` | 37 | 1851 | 0.018 | a leg, seen between the other animal's legs | 2% |
| `zebras` | 25 | 1165 | 0.012 | a haunch, split off by the foreground animal | 2% |
| `hug` | 1 | 713 | 0.0047 | **a hand — fingers, resolved correctly** | 0.5% |
| `pillar` | 37 | 86 | 0.0094 | the last sliver of the man past the column | 1% |

Below roughly `1e-3` the population turns into silhouette fringe: 28–47px specks sitting on or
within a few pixels of the subject's own outline. Those are noise in any useful sense. But they are
not separated from the anatomy above them by any gap — they shade into it.

### The occlusion split, frame by frame

`pillar` is the cleanest false-positive generator: a man walks behind a column, so his mask is
genuinely two pieces for eight frames before he disappears. Second-piece ratio by frame:

```
  f37     86px  ratio=0.0094
  f39   3243px  ratio=0.8762
  f40   2978px  ratio=0.9943
  f41   2467px  ratio=0.8971
  f42   1904px  ratio=0.7970
  f43   1530px  ratio=0.7244
  f44    975px  ratio=0.5838
  f45    357px  ratio=0.3145   + a third piece, 107px, ratio=0.0943
  f46    280px  ratio=0.4811
```

A real, load-bearing piece of the subject occupies **ratio 0.0094 through 0.994, continuously**.
Any threshold at or above 1% amputates part of this man.

## 3. What a filter would cost

"Real" here is an automatic proxy: the component's pixels lie inside the object's **main blob in an
adjacent frame** (3px dilation slack for motion). A part that detaches briefly and rejoins
satisfies it; a codec/model speck floating in the background does not. 71 of the 423 non-largest
components qualify.

**The proxy is conservative, and knowing how it fails matters more than the number.** It only sees
parts that rejoin the body within one frame. A part that stays detached for the whole time it is
visible never qualifies — and that is exactly what the tails do:

```
zebras obj0 f 2  2809px  r=0.045  m_prev=0.0  m_next=0.0   track spans 4 frames
zebras obj1 f 5  4069px  r=0.042  m_prev=0.0  m_next=0.0   track spans 6 frames
zebras obj1 f37  1851px  r=0.018  m_prev=0.0  m_next=0.0   track spans 7 frames
```

All three were cropped and looked at; all three are unmistakably real anatomy. The proxy scores
them 0. So **the "real removed" column below is a floor, not the true cost** — the visually
confirmed tails at 4–5% sit on top of it, and they are the most conspicuous thing the rim draws.

| threshold | components removed | **real** removed | largest real removed |
|---|---|---|---|
| 0.1% | 249 | **53** | 124px |
| 0.2% | 269 | **58** | 606px |
| 0.5% | 287 | **60** | 713px — the hand |
| 1% | 309 | **62** | 796px |
| **2%** (§4's suggestion) | 329 | **64** | 1668px |
| 5% | 339 | **66** | 5164px |
| 10% | 361 | **66** | 5164px |
| 20% | 372 | **66** | 5164px |

There is no knee. The real-removal count barely moves as the threshold drops, because real
components are spread across the whole range rather than clustered above it. By the proxy the
smallest qualifying component is a single pixel — at that size the proxy is really reporting
silhouette jitter rather than a limb, so read the bottom row with care. The rows that matter are
the ones with eyes on them: the hand at 0.5%, the leg at 1%, the tails at 4–5%. A filter cannot be
tuned out of this; over the range that is visually conspicuous, signal and noise are the same size.

## 4. Temporal persistence — measured, also insufficient

Persistence was the most promising alternative, so it was measured properly rather than assumed.
Track = components in consecutive frames sharing at least one pixel.

| population | n | track_len median | mean | p90 | max |
|---|---|---|---|---|---|
| real (attached in an adjacent frame) | 71 | 50 | 43.5 | 50 | 50 |
| stray | 352 | 7 | 20.7 | **50** | 50 |

The medians differ by 7x, which looks encouraging until you read the p90: **stray components reach
the full 50-frame clip length just as real ones do.** The distributions overlap across most of
their mass. Dropping every component whose track spans a single frame removes 121 of 423 — and
still takes 9 real ones with it.

And the labels are worse than the table admits: the "stray" row **contains the tails**, which are
real anatomy with 4–7 frame tracks (§3). Persistence cannot separate what the labelling itself
cannot separate. A tail that is visible and detached for six frames and a compression speck that
flickers for six frames look identical to any temporal rule.

Restricted to clearly-tiny components (ratio < 0.5%), stray tracks do live about one frame
(median 1.0, max 2 on most clips, 10 on `zebras` obj1) while the main blob lives all 50. So
persistence *is* a real signal at the very bottom of the size range — but that is precisely the
range where the components are 30px silhouette fringe that nobody would notice anyway. It does
nothing about the 4069px rimmed tail, which is the conspicuous case and is also correct.

## 5. Footage dependence

| clip | non-largest components | per frame per object |
|---|---|---|
| `studio` (clean bg, 1 subject) | 1 | 0.02 |
| `dogs` (clean snow bg, 2 subjects) | 8 | 0.08 |
| `pillar` (occlusion) | 15 | 0.30 (mostly the real split) |
| `hug` (2 overlapping subjects) | 165 | 1.65 |
| `zebras` (camouflage + clutter) | 234 | 2.34 |

Fragmentation tracks scene clutter and camouflage. On the footage where masks are easy it is
already ~zero, so a default-on filter would spend its risk budget on clips that do not need it.
It also confirms §4's read that this is a property of hard real data, not of the code.

### 5a. The backend is not the variable — footage is (measured 2026-07-25)

An earlier claim that fragmentation was "specific to the CUDA multiplex video predictor" was wrong,
and worth recording because it was believed for a while. It came from a confounded comparison: the
CoreML backend had only ever been run on easy inputs (two stills and a 15-frame clip of a person on
a clean background, all ~zero strays), while the fragmenting case was CUDA on the zebras.

Re-running the SAME clip through CoreML settles it — Pexels 37425597, same 0–2s window, same
`zebra` prompt, same `--objects 2`, same 2% rule, 50 frames:

| backend | object 0 | object 1 |
|---|---|---|
| cuda | 75 strays, largest 1118 px | 202 strays, largest 1824 px |
| coreml | 78 strays, largest 866 px | 44 strays, largest 956 px |

Object 0 is effectively identical across backends. Both fragment substantially on hard footage, so
the backend does not explain the artifact and choosing one over the other will not avoid it. (The
object-1 gap is real but is a tracking-quality difference on one object, not a difference in kind;
it was not investigated further.)

## 6. Bonus: painter's-order overlap, still unexercised

§4 noted the two zebras were disjoint on all 50 frames, leaving the `masks[]` painter's-order rule
(later entry paints over earlier) synthetic-fixture-only. This run added two more two-subject
clips, one of them **two people in a full embrace** — arms wrapped around each other, heavily
interleaved in the image plane.

```
zebras: R&G overlap 0/50 frames, max 0px
hug:    R&G overlap 0/50 frames, max 0px
dogs:   R&G overlap 0/48 frames, max 0px
```

**Zero overlapping pixels across 148 frames.** SAM3.1's multiplex tracker assigns each pixel to at
most one object, so per-object masks come out mutually exclusive by construction. Painter's order
will essentially never fire on real SAM output — it remains a synthetic-fixture rule, and that now
looks like a property of the model rather than of the footage. Worth knowing before anyone designs
a feature that depends on it.

Also checked, and clean: **no cross-object misassignment.** Zero fragments of one object sit more
than half inside the other object's mask, on any clip. The "amber blob on the cyan zebra's back"
from §4 is not a channel mix-up — it is a genuine (small) part of the amber animal that happens to
sit visually in front of the cyan one.

## Decision: ship nothing

A minimum-area connected-component filter is **not safe at any threshold**, and the data says so
without much ambiguity. Shipping one would mean silently deleting tails, hands and occluded limbs
from every user's masks, on a GPU-only code path where nobody would see it happen. That is strictly
worse than the artifact it fixes — the artifact is visible and diagnosable; the amputation would
not be.

The reframe that matters: **these fragments are mostly not defects.** SAM is correctly reporting
that a zebra's tail is disconnected from its body in the image plane because another zebra is in
the way. The rim shader tracing it is the rim doing its job. §4 read the artifact as "the mask is
fragmented"; the measurement says "the subject really is fragmented, and the rim is honest about
it".

What is left that is genuinely undesirable is a thin band at the bottom — sub-0.1% silhouette
fringe, 30-ish px, one frame long. That is real but minor, and it is not what makes the frame look
wrong.

### If this is ever revisited

- **Do not use area alone.** Section 3 is the argument; the numbers do not improve with tuning.
- The only defensible automatic form is **conjunctive**: tiny (ratio < 0.1%) **and** temporally
  unsupported (not inside the main blob in either neighbouring frame). Measured on this data that
  removes 196 of 423 components and loses none that the proxy scores as real — and the proxy's
  known blind spot (persistently-detached parts like the tails) sits at 1.8–4.5%, far above the
  0.1% cut, so that blind spot does not bite here. It needs a 3-frame window, so it is not a pure
  function of one mask, and it only cleans the fringe, not the conspicuous rimmed anatomy.
- The better home for it is **render-time and opt-in**, per shot: an author who knows their subject
  is a single blob can ask for largest-component-only, and an author cutting the zebras can decline.
  A per-shot opt-in cannot silently amputate anyone, which is the property the runner-side default
  lacks.
- Any such option should be documented as changing the mask, not cleaning it.

## Reproducing

Analysis is connected-component labelling (8-connected, run-based union-find, numpy only) over the
frames decoded from `mask.mp4`, per object per frame, plus adjacent-frame overlap for the "real"
proxy. All of it runs off the mask artifacts alone — no GPU needed to re-check the conclusions,
only to regenerate masks for new footage.

Footage credits: Pexels 37425597 (Magda Ehlers), 5233469, 8511939, 6570474, 10774275.
