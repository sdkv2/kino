# Build & preview

`kino build` turns a spec into a finished MP4. Nothing it does costs money unless you pass `--tts` — a plain build is silent and full quality, so most of your time is spent iterating for free. This page covers the pipeline, the loop, and how caching keeps rebuilds fast. Command flags live in the [CLI reference](cli-reference.md#build--preview).

- [The pipeline](#the-pipeline)
- [What costs money](#what-costs-money)
- [The iterate loop](#the-iterate-loop)
- [Caching](#caching)
- [Variants & batch](#variants--batch)
- [Output layout](#output-layout)

## The pipeline

Every build runs the same stages:

```
spec → validate → voiceover → avatar plan/trim → stage assets → background + fonts → frame render → mux → variant tag
```

- **validate** — parse the spec, resolve provider/voice/look, check every SFX/music/asset ref. A bad ref fails here, **before** any paid API call.
- **voiceover** — one ElevenLabs read per segment `text`, stitched with gaps into the VO track (skipped/silent under `--mock`).
- **presenter plan/trim** — pick the on-camera beats (a `scene` whose `source` is a presenter), trim the VO to just those windows, lip-sync them at the provider. No presenter sources or `provider: none` → this stage is skipped. See [Avatars](avatars.md).
- **stage assets** — copy the spec's assets (footage, frames, images), resolve SFX/music, download the brand font.
- **render** — kino's frame engine (headless Chromium) composites captions, background/overlays, footage, and audio into frames and encodes the MP4, once per `format`.

`prepare()` is the shared resolver that runs everything **up to** the final encode. The preview commands (`still`, `storyboard`, `inspect`) reuse it, so a preview resolves through the exact same code path as a real build — what you see is what you'll get.

## What costs money

**`--tts` is the only flag that spends.** Everything else is free, including a full-quality render.

| Command | Voice | Quality | Cost |
|---|---|---|---|
| `kino build <spec>` | silent | **full** (1080-class) | $0 |
| `kino build <spec> --draft` | silent | 720p, fast encode | $0 |
| `kino build <spec> --tts` | real ElevenLabs VO + presenter | full | **ElevenLabs (+ avatar credits)** |
| `kino build <spec> --tts --no-avatar` | real VO, no presenter | full | ElevenLabs only |
| `still` / `storyboard` / `inspect` | estimated | — | $0 (after a `--tts` build, `--real` reuses its true VO times, still $0) |

Silent builds and previews estimate timing from word counts; `--tts` produces true per-word
timings. So the loop is: get structure, layout, and beat order right for free — a silent build is
already final quality, so it is a real deliverable, not just a preview — and add `--tts` only when
you want the voiceover, or to lock speech-synced timing so captions and triggers land on the
actual words.

> Voice used to be **on** by default and `--no-tts` opted out. It is the other way round now: a
> plain build never bills you, and `--draft` only controls render speed and size.

## The iterate loop

```
kino inspect <spec>            # read beats + timings as JSON (--real reuses a --tts build's true times)
kino still <spec> --segment 0  # one frame, fast — the quickest visual check
kino storyboard <spec>         # one still per beat, tiled — catch overlap/overflow at a glance
# …edit the spec…
kino build <spec> --draft      # free 720p preview, fastest
kino build <spec>              # free FULL-quality silent render
kino build <spec> --tts        # add the voiceover once it's right (bills ElevenLabs)
kino retune <spec>             # after a real build: snap trigger times to spoken words
```

Add `--platform tiktok|reels|shorts` to `still`/`storyboard` to overlay in-feed safe zones. For speech-synced motion, build real once, then [`retune`](cli-reference.md#retune) rewrites beat-relative `triggers[].at` onto the actual VO words instead of hand-editing.

## Caching

Paid, slow outputs are content-cached under `.kino-cache/` and keyed by a hash of everything that changes the pixels/audio. An edit that doesn't touch a given input **reuses** the cached output:

- **VO** — cached per segment on `text` + voice + model. Edit one beat's line → only that read regenerates.
- **Avatar** — cached on provider + look/portrait + the trimmed-audio bytes. Unchanged presenter beats are reused across rebuilds.

So the second build after a small edit is fast and cheap — only the changed beats re-hit an API.

## Render speed (shader / glass)

Heavy WebGL backgrounds (raymarch) + `kino-lens` are the slow path. Every frame is composited on a single WebGL stage (layers are textures; motion HTML is rasterized per frame). Env levers:

Rendering runs on an **Electron offscreen host**: one Chromium GPU process serving N offscreen
windows. The GL backend is fixed per platform — ANGLE over Metal on macOS, D3D11 on Windows, Vulkan
on Linux — rather than probed, because a wrong guess fails *silently* (a dead GL context renders a
flat wash, not an error). Every render prints which backend it used.

On Linux this needs a **real X/Wayland display**: `--ozone-platform=headless` boots but yields no
WebGL2 on any backend, so run under `xvfb-run` on a headless box. `kino doctor` checks for it.

| Env | Effect |
|---|---|
| `KINO_SHADER_SSAA=1..4` | Override supersample. Mock builds default to **1** (~4× cheaper fill); finals default to **2**. |
| `KINO_SHADER_FXAA=0` | Disable the default FXAA edge post-pass on shader backgrounds. |
| `KINO_SHADER_DRAFT=1` | Force SS=1 even on non-mock encodes. |
| `KINO_DRAFT_EDGE=<px>\|off` | Draft output short edge (default **720**). The composition is unchanged — a draft is the same frame on fewer pixels. `off` renders drafts at full size. |
| `KINO_ELECTRON_CAPTURE=…` | Pin the capture backend: `shared`, `readback`, `direct`, `page` (default `auto`). |
| `KINO_RB_SYNC=1` | `readback` only: restore the pre-PBO synchronous `readPixels` transport. For A/B-ing the two on one build — the PBO default measured 23.5ms/frame vs 34.6ms on an M4. |
| `KINO_ELECTRON_ARGS="…"` | Extra Chromium flags for the render host. A `--use-angle` here overrides the platform default. |
| `KINO_CONCURRENCY=N` | Render worker count. Auto default caps at 4; override for more VRAM/compute. Linux also bounds by probed VRAM and NVENC sessions (`KINO_VRAM_PER_WORKER`, `KINO_NVENC_SESSIONS`). |

Example: `KINO_ELECTRON_ARGS="--use-angle=swiftshader-webgl --enable-unsafe-swiftshader" kino build specs/foo.json --mock`
pins SwiftShader, the bit-stable path to use when output must match byte-for-byte across machines.

## Rendering a queue: shard across processes, don't just raise concurrency

Raising `KINO_CONCURRENCY` stops helping well before the machine runs out. All of a build's workers
share **one Chromium GPU process**, and their GL command streams and WebCodecs readbacks serialise
through it, so a single build plateaus around **180–210 fps** — measured inside that same band on an
M4, an RTX 3060 Ti and an RTX 4090. A 4090 does not render one video faster than a 3060 Ti; the
limit is not the GPU.

Running several builds at once sidesteps it, because each gets its own GPU process:

| box | one build | sharded | gain |
|---|---|---|---|
| RTX 3060 Ti, 23 vCPU | 170–175 fps (c=8) | **246 fps** (3 × c=4) | +41% |
| RTX 4090, 61 vCPU | ~190 fps (c=8) | **578 fps** (8 × c=4) | ~3× |

```bash
node scripts/shard-render.mjs projects/*/specs/*.json
```

It picks the shard count from the machine (~7 cores per `c=4` build) and prints per-build and
aggregate fps. `--shards N` and `--concurrency C` override; `--dry-run` shows the plan. It reports
two rates, because they answer different questions: **render** (per-build render-phase fps, summed)
is what the table above measures and what shows the sharding win, while **end-to-end** is total
frames ÷ wall and includes media extraction, page boot and audio — on short specs those fixed costs
dominate and it lands far lower. When benchmarking, add `KINO_NO_FRAME_CACHE=1`; a re-run otherwise
serves frames from `.frame-cache` and reports four-digit "fps" that measure disk (the script says so
when it happens).

What you hit instead is a real resource: CPU on the 3060 Ti (23.3 of 23 cores at 3 builds), GPU on
the 4090 (99% at 8 builds) — both better places to stop than an architectural ceiling. Past the
knee it degrades gently (4 builds measured 238 fps vs 3 builds' 246), so erring one shard high is
cheap.

Two caveats. This raises **throughput for a batch, not the speed of any one video** — a single
build still runs through a single instance. And `c=4` per build beats fewer-bigger builds:
concurrency inside a build is what contends, while separate builds mostly don't.

## Variants & batch

Render many cuts in one shot with [`batch`](cli-reference.md#batch). The **variants** form patches one base spec N ways and builds each tagged:

```json
{
  "base": "specs/advert.json",
  "variants": [
    { "tag": "hook-a", "set": { "segments.0.text": "Make me a trailer." } },
    { "tag": "hook-b", "set": { "segments.0.text": "Make me a demo." }, "format": "9:16,3:4" }
  ]
}
```

`set` uses dotted paths into the parsed base and only replaces existing leaves. Variant specs land under `out/<title>/.batch/`, each built with `--tag`. A `--tag` (also auto-set from `--background`/`--font`) suffixes the filename so variants don't overwrite each other.

## Output layout

```
out/<title>/<title>[-<tag>]-<format>.mp4
```

One folder per spec title; one file per format (and per tag). Untagged renders of the same title/format overwrite — tag anything you want to keep side by side.
