# Audio

A kino video has three audio layers, mixed automatically at render:

1. **Voiceover** — the spoken track (ElevenLabs TTS), one read per segment `text`. It drives the whole timeline: caption timing, cuts, and ducking all key off the VO word timings.
2. **Music bed** — one optional track under the whole video, **auto-ducked** while any segment is speaking.
3. **Sound effects** — free-placed one-shots at explicit timestamps.

VO always wins: the bed ducks and SFX sit under it. For where these fields live in the JSON, see the [Spec reference](spec-reference.md#sound-effects--music); for the commands, see the [CLI reference](cli-reference.md). To *write* VO that doesn't sound like AI, use the [`ad-voice`](../skills/ad-voice/SKILL.md) skill.

- [Voiceover](#voiceover)
- [Music beds](#music-beds)
- [Sound effects](#sound-effects)
- [Authoring against real audio](#authoring-against-real-audio)
- [Licensing & attribution](#licensing--attribution)

## Voiceover

Every segment's `text` is spoken. Pick the voice once at the top of the spec:

```json
{
  "voice": "narrator",
  "voiceModel": "eleven_v3",
  "segments": [{ "kind": "hero", "text": "Paste the job post. We rebuild the bullets." }]
}
```

- **`voice`** — an ElevenLabs voice id, or a `brand.voiceAliases` alias (e.g. `"narrator"` → an id). Falls back to `brand.defaultVoice` when unset. List real voices with `kino voices [--gender <g>]`.
- **`voiceModel`** — the TTS model. Default `eleven_v3`, which supports **inline audio tags** in `text` — `[excited]`, `[whispers]`, `[short pause]`, etc. Tags are spoken as direction and **stripped from the word-synced captions**. Set `eleven_multilingual_v2` for more timing-stable / metronome-critical reads (no tags). Both `voice` and `voiceModel` can be defaulted per brand (`brand.defaultVoice`, `brand.voiceModel`) — the spec value wins.

Get exact per-word VO timings with `kino inspect <spec> --real` — use them to place `sfx[].at`, cuts, and background keyframes on the words.

## Imported real voiceover (`voFile`)

Any beat can use a **recorded voiceover file** instead of TTS — your own read, a client's VO, a
podcast clip — by pointing `voFile` at a project audio asset:

```json
{ "kind": "motion", "source": "motion/stat.html",
  "text": "Eighty six percent match, before you hit apply.",
  "voFile": "vo/stat-take3.mp3" }
```

- The file (any ffmpeg-readable format) becomes the beat's clip verbatim — never trimmed or
  re-paced; the beat's length is the file's length. `voFile` and TTS beats mix freely, and
  `voFile` audio drives avatar lip-sync like any other clip.
- **Word timings come from speech-to-text on real builds**: ElevenLabs **Scribe** when
  `ELEVENLABS_API_KEY` is set, else **local whisper.cpp** (`brew install whisper-cpp`; the
  ggml-base.en model auto-downloads once to `~/.kino/whisper/`). Force either with
  `KINO_STT=whisper|scribe`, point at a custom binary/model with `KINO_WHISPER` /
  `KINO_WHISPER_MODEL`. Transcripts are content-hash cached — re-builds don't re-transcribe.
- A spec whose **every** beat has a `voFile` needs no ElevenLabs key and no `voice` at all — a
  fully keyless real build.
- **Mock builds stay free/offline**: the beat gets the file's true duration with the spec `text`
  paced evenly across it (no STT call).
- Keep the segment `text` matching what the recording says — captions and `atWord` anchors use the
  **transcribed** words, and STT normalizes some tokens ("thirty" → "30"); an `atWord` miss fails
  the build listing the transcribed words, so anchor to those (or a word index).

## Music beds

One bed plays under the entire video. It **ducks automatically** whenever a segment is speaking, so you never hand-key volume around the VO:

```json
"music": { "src": "music/bed.mp3", "volume": 0.12, "duck": 0.04, "fadeInSec": 0, "fadeOutSec": 2 }
```

| Field | Default | Meaning |
|---|---|---|
| `src` | — | Bed source (bare id or asset path — see below). |
| `volume` | `0.12` | Bed level when no one is speaking. Keep quiet under VO (`0.10–0.14`). |
| `duck` | `0.04` | Level while a segment speaks, with 0.3s linear ramps in/out of each VO span. |
| `fadeInSec` | `0` | Head fade from silence (avoids a click on loop-audio starts). |
| `fadeOutSec` | `2` | Linear tail fade to silence at the end of the video. |

Overlapping VO spans take the *most-ducked* level, so back-to-back beats never pop the bed up in a short gap. The curve is `musicVolumeAt` in [`src/render/audio.ts`](../src/render/audio.ts).

**Sourcing beds** — `kino music`:

```bash
kino music                                  # list library beds (assets-lib/music/ — ships empty)
kino music "lofi piano" --get 2 --project x # search Freesound CC0, download match 2
```

No beds ship with kino — drop a CC0 `.mp3` into `assets-lib/music/` to resolve its bare id straight from `music.src`, or (the usual route) keep beds in the project's `assets/music/` and use a path. Freesound search targets short-form beds (CC0 only, 15–90s). Trending TikTok/Reels audio is **not** pullable via API (copyright). Full flag table in the [CLI reference](cli-reference.md#music).

## Sound effects

Free-placed one-shots on the main timeline. Omit `sfx` entirely for **silent cuts** — the preferred short-form default (no bundled whoosh):

```json
"sfx": [
  { "src": "sfx/click.mp3", "at": 0.45, "volume": 0.22 },
  { "src": "sfx/impact.mp3", "at": 7.9,  "volume": 0.7 }
]
```

- **`at`** — seconds on the main timeline.
- **`volume`** — 0–1, default `1`.
- **`src`** (both `sfx[]` and `music`) — a **bare id** (no slash, no extension) resolves from the shared library at `assets-lib/sfx/<id>` then `assets-lib/music/<id>` (`.mp3`/`.wav`). Both shared libraries ship empty — add your own clips there, or use a path. A **path** (e.g. `sfx/click.mp3`) resolves from the project's `assets/`. Every ref is checked at validate time, before any API spend — a bad id fails the build early.

Silent cuts + a ducked bed read cleaner than busy SFX. Reach for effects sparingly, on a real beat.

## Authoring against real audio

Don't guess timestamps. Run `kino audio-markers <file>` on the VO track (or a music file) to get the structure to place cuts and `sfx[].at` against:

```bash
kino audio-markers .kino-cache/<title>/vo-0.mp3     # onsets/peaks/silences of the VO
kino audio-markers assets/music/bed.mp3 --out markers/
```

It writes `<name>.markers.json` (`{ durationSec, rms[], onsets[], peaks[], silences[] }`) plus `<name>.wave.png` and `<name>.spectrum.png` for an eyeball read. Works on any audio or video file — the cached VO, an imported bed, or an external reference. Details in the [CLI reference](cli-reference.md#audio-markers).

## Licensing & attribution

Bundled beds are CC0 (safe in ads, no attribution needed). Freesound downloads via `kino music` are filtered to **CC0 only** and each download is appended to the project's `ATTRIBUTION.md` — keep that file with the project. VO and avatar audio are generated per render and aren't redistributable stock.
