# Build & preview

`kino build` turns a spec into a finished MP4. But most of your time is spent in the **preview loop** — cheap, mock renders that check structure and timing before you spend a cent on real voiceover or an avatar. This page covers the pipeline, the loop, and how caching keeps rebuilds fast. Command flags live in the [CLI reference](cli-reference.md#build--preview).

- [The pipeline](#the-pipeline)
- [Mock vs real](#mock-vs-real)
- [The iterate loop](#the-iterate-loop)
- [Caching](#caching)
- [Variants & batch](#variants--batch)
- [Output layout](#output-layout)

## The pipeline

Every build runs the same stages:

```
spec → validate → voiceover → avatar plan/trim → stage assets → background + fonts → Remotion render → mux → variant tag
```

- **validate** — parse the spec, resolve provider/voice/look, check every SFX/music/asset ref. A bad ref fails here, **before** any paid API call.
- **voiceover** — one ElevenLabs read per segment `text`, stitched with gaps into the VO track (skipped/silent under `--mock`).
- **avatar plan/trim** — pick the on-camera (`avatar`) beats, trim the VO to just those windows, lip-sync them at the provider. No `avatar` beats or `provider: none` → faceless, this stage is skipped. See [Avatars](avatars.md).
- **stage assets** — copy the spec's assets (footage, frames, images), resolve SFX/music, download the brand font.
- **render** — Remotion composites captions, background/overlays, footage, and audio into frames and encodes the MP4, once per `format`.

`prepare()` is the shared resolver that runs everything **up to** the final encode. The preview commands (`still`, `storyboard`, `inspect`) reuse it, so a preview resolves through the exact same code path as a real build — what you see is what you'll get.

## Mock vs real

The single most important habit: **mock first**.

- `--mock` (build) and the default for `still`/`storyboard`/`inspect` use a **silent estimated VO** and a placeholder avatar — no API spend. Timing is estimated from word counts.
- `--real` (preview) / a plain `kino build` (no `--mock`) use **real** ElevenLabs VO and true per-word timings, and generate the avatar.

Get structure, layout, and beat order right on mock. Switch to real only to lock timing (captions/triggers land on the actual words) and to render the final.

## The iterate loop

```
kino inspect <spec>            # read beats + timings as JSON (add --real for true VO times)
kino still <spec> --segment 0  # one frame, fast — the quickest visual check
kino storyboard <spec>         # one still per beat, tiled — catch overlap/overflow at a glance
# …edit the spec…
kino build <spec> --mock       # free full render
kino build <spec>              # real render once it's right
kino retune <spec>             # after a real build: snap trigger times to spoken words
```

Add `--platform tiktok|reels|shorts` to `still`/`storyboard` to overlay in-feed safe zones. For speech-synced motion, build real once, then [`retune`](cli-reference.md#retune) rewrites beat-relative `triggers[].at` onto the actual VO words instead of hand-editing.

## Caching

Paid, slow outputs are content-cached under `.kino-cache/` and keyed by a hash of everything that changes the pixels/audio. An edit that doesn't touch a given input **reuses** the cached output:

- **VO** — cached per segment on `text` + voice + model. Edit one beat's line → only that read regenerates.
- **Avatar** — cached on provider + look/portrait + the trimmed-audio bytes. Unchanged presenter beats are reused across rebuilds.

So the second build after a small edit is fast and cheap — only the changed beats re-hit an API.

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
