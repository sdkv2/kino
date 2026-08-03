# Audio

A kino video has three audio layers, mixed automatically at render:

1. **Voiceover** — the spoken track (ElevenLabs TTS), one read per segment `text`. It drives the whole timeline: caption timing, cuts, and ducking all key off the VO word timings.
2. **Music beds** — one or more optional tracks under the whole video, **auto-ducked** while any segment is speaking.
3. **Sound effects** — free-placed one-shots at explicit timestamps.

VO always wins: the bed ducks and SFX sit under it. For where these fields live in the JSON, see the [Spec reference](spec-reference.md#sound-effects--music); for the commands, see the [CLI reference](cli-reference.md). To *write* VO that doesn't sound like AI, use the [`ad-voice`](../skills/ad-voice/SKILL.md) skill.

**The mix sums, it does not normalize.** Every layer keeps exactly the level you authored (`amix … normalize=0`), so nothing quietly attenuates when you add a second bed or a loud effect — and nothing catches you when the total goes past full scale and clips. Budget the headroom yourself: a short-form piece with VO wants beds around `0.12`, and stacked beds want to *share* that, not each take it. `kino build` warns when the beds alone peak past `1.0`.

- [Voiceover](#voiceover)
- [Music beds](#music-beds)
  - [Riding the bed (`music.keyframes`)](#riding-the-bed-musickeyframes)
  - [Stacking beds](#stacking-beds)
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

- **`voice`** — an ElevenLabs voice id, or a `brand.voiceAliases` alias (e.g. `"narrator"` → an id). Falls back to `brand.defaultVoice` when unset. **Always search before picking:** run `kino voices [--gender <g>]` and choose the most appropriate match to the brand's Tone/Voice (and the avatar's gender/age when a presenter is used) — never default to the same voice across brands without searching the catalog.
- **`voiceModel`** — the TTS model. Default `eleven_v3`, which supports **inline audio tags** in `text` — `[excited]`, `[whispers]`, `[short pause]`, etc. Tags are spoken as direction and **stripped from the word-synced captions**. Set `eleven_multilingual_v2` for more timing-stable / metronome-critical reads (no tags). Both `voice` and `voiceModel` can be defaulted per brand (`brand.defaultVoice`, `brand.voiceModel`) — the spec value wins.

- **`voVolume`** — a 0–1 gain on the whole VO track, top level, default `1`. Reach for it when the read sits too far in front of a busy bed and you would rather move the VO than fight every other level. It does **not** change ducking: the bed ducks on *when* segments speak, not how loud they are, so turning the VO down does not open the bed back up.

Get exact per-word VO timings with `kino inspect <spec> --real` — use them to place `sfx[].at`, cuts, and background keyframes on the words. `--real` reads the voiceover a previous `kino build <spec> --tts` cached, so run that once first; it errors rather than falling back to the estimate.

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

A bed plays under the entire video. It **ducks automatically** whenever a segment is speaking, so you never hand-key volume around the VO:

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
| `startSec` | `0` | Offset into the source the bed plays from (sample-accurate). Set by `kino sync --offset auto`, or by hand to skip an intro. |
| `keyframes` | — | Hand-keyed bed level over time — see [Riding the bed](#riding-the-bed-musickeyframes). |

**Music-only pieces:** with no VO there is nothing to duck under — set `volume` to the level you
want (e.g. `0.85`) and `duck` to the same value.

Overlapping VO spans take the *most-ducked* level, so back-to-back beats never pop the bed up in a short gap. The curve is `musicVolumeAt` in [`src/render/audio.ts`](../src/render/audio.ts).

### Riding the bed (`music.keyframes`)

Auto-ducking handles the VO. `keyframes` handle everything ducking can't hear: a drop on a cut, a
swell into the CTA, a bed that has to get out of the way of a piece of footage that has its own
audio.

```json
"music": {
  "src": "music/bed.mp3", "volume": 0.12,
  "keyframes": [
    { "at": 4.0, "params": { "volume": 0.12 } },
    { "at": 4.4, "params": { "volume": 0 } },
    { "at": 6.0, "params": { "volume": 0 } },
    { "at": 6.6, "params": { "volume": 0.3 }, "ease": "easeOut" }
  ]
}
```

`at` is **absolute seconds on the main timeline** — the same clock as `sfx[].at` and the same one
`kino inspect` prints — not an offset into the source file. `startSec` moves what the bed is
playing; keyframes move how loud it is, and the two are independent.

Three things worth knowing before you key anything:

- **`volume` is the implicit `t=0` keyframe.** A lone keyframe *tweens from the bed's base level*
  rather than snapping to itself — the same rule as motion `params` and effect keyframes. Want a
  flat level up to a point and then a move? Key the flat level explicitly first, as above at `4.0`.
- **Ducking still applies on top.** The bed's level at any instant is the *lower* of your curve and
  the duck. So keyframing to `0` is a **hard gate** the VO can't lift back up, which is exactly what
  you want for a silent beat — and a VO span that lands inside a fade ramps toward the level the bed
  is actually at, rather than stepping back up to the authored `volume` and then ducking from there.
- **The fades are still multiplicative.** `fadeInSec`/`fadeOutSec` scale whatever the curve says, so
  a bed keyframed up to `0.3` at the end still fades out over `fadeOutSec`.

`ease` takes any of the [standard curve names](spec-reference.md#keyframes--triggers); `hold` steps
at the keyframe instead of lerping, which is the one to use for a hard mute.

### Stacking beds

`music` also accepts an **array**, for a bed that is really two or three parts — a drone, a pulse
that only enters at the turn, a riser under the CTA:

```json
"music": [
  { "src": "music/drone.mp3", "volume": 0.10, "duck": 0.04 },
  { "src": "music/pulse.mp3", "volume": 0, "duck": 0,
    "keyframes": [{ "at": 5.2, "params": { "volume": 0 } }, { "at": 5.6, "params": { "volume": 0.09 } }] }
]
```

Every bed ducks under the same VO spans; each keeps its own `volume`, `duck`, `startSec`,
`fadeInSec`/`fadeOutSec` and `keyframes`. Two traps:

- **They sum.** Two beds at `0.12` are `0.24` under the VO, not `0.12` — the mix does plain
  summation. Split the budget you would have given one bed, don't repeat it. `kino build` warns
  when the beds alone peak past full scale.
- **`kino sync` fits its grid to the first bed.** Put the one with the pulse first, and keep the
  others phase-locked to it by hand (`startSec`).

A bed that should only appear later is a bed keyframed up from `0` — there is no `startSec`-on-the-
timeline field, because a bed's `startSec` is an offset into *its own file*.

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
  { "src": "sfx/impact.mp3", "at": 7.9,  "volume": 0.7, "pan": -0.6, "rate": 1.2 }
]
```

- **`at`** — seconds on the main timeline.
- **`volume`** — 0–1, default `1`.
- **`pan`** — `-1` hard left … `0` centre … `1` hard right, default `0`. Constant-power, scaled so
  the centre is unity — `0` is genuinely "no pan" (kino emits no pan filter for it), and sweeping a
  sound across the field has no step in the middle. The catch: constant power means a hard pan is
  **+3 dB** in the channel it lands in, so a hard-panned hit at the same `volume` as a centred one
  is noticeably louder. Pull `volume` down when you push `pan` out.
- **`rate`** — playback rate, `>0`, default `1`. **Varispeed**: pitch and duration move together,
  like pitching a sampler up. That is the right behaviour for transients — a semitone on a 100 ms
  click costs about 6% of its length and nobody hears it — and the wrong tool for anything with a
  tune in it, which will go up in key. It is *not* pitch-preserving time-stretch. The event still
  starts at exactly `at`; only its tail moves.
- **`src`** (both `sfx[]` and `music`) — a **bare id** (no slash, no extension) resolves from the shared library at `assets-lib/sfx/<id>` then `assets-lib/music/<id>` (`.mp3`/`.wav`). Both shared libraries ship empty — add your own clips there, or use a path. A **path** (e.g. `sfx/click.mp3`) resolves from the project's `assets/`. Every ref is checked at validate time, before any API spend — a bad id fails the build early.

Silent cuts + a ducked bed read cleaner than busy SFX. Reach for effects sparingly, on a real beat.

`pan` and `rate` are also the cheap way to get variety out of **one** sample: the same click at
`rate` 1.0 / 1.12 / 0.94, alternating left and right, reads as three different sounds instead of a
repeat. Reuse beats sourcing a second file.

## Authoring against real audio

Don't guess timestamps. Run `kino audio-markers <file>` on the VO track (or a music file) to get the structure to place cuts and `sfx[].at` against:

```bash
kino audio-markers .kino-cache/<title>/vo-0.mp3     # onsets/peaks/silences of the VO
kino audio-markers assets/music/bed.mp3 --out markers/
```

It writes `<name>.markers.json` (`{ durationSec, rms[], onsets[], peaks[], silences[], grid }`) plus `<name>.wave.png` and `<name>.spectrum.png` for an eyeball read. Works on any audio or video file — the cached VO, an imported bed, or an external reference. Details in the [CLI reference](cli-reference.md#audio-markers).

`grid` is the track's beat grid — `{ bpm, periodSec, phaseSec, strength }`, or `null` for beatless
audio. Onsets are 0.1s-quantized (SFX placement precision); the grid is fit from a 10 ms
kick-band envelope, so it's the one to trust for beat math. `strength` below ~0.5 means the pulse
is too loose to sync cuts against.

## Beat-syncing cuts (`kino sync`)

For a music-driven piece (no VO, or VO already built), `kino sync <spec>` retimes every cut to the
bed's beat grid:

```bash
kino sync specs/promo.json --offset auto --dry-run   # preview: bpm, startSec, per-cut deltas
kino sync specs/promo.json --offset auto             # write music.startSec + new durs
```

- Detects bpm/phase **locally over the stretch that will play** (real tracks drift), then rewrites
  each visual beat's `dur` so cuts — and the video end — land on the grid. `--grain bar` (default)
  snaps to every 4th beat; `--grain beat` cuts faster.
- `--offset auto` scans the whole track for the loudest on-grid window of the video's length and
  writes it to `music.startSec`, so the piece opens on a hit.
- VO-driven beats are untouched (their length is the recording); the next visual beat re-anchors
  the timeline on the grid. On spoken specs run sync **after** the real VO exists, like `retune`.
- A weak grid (strength < 0.5) logs a warning — pick a more percussive track rather than fighting it.

## Licensing & attribution

Bundled beds are CC0 (safe in ads, no attribution needed). Freesound downloads via `kino music` are filtered to **CC0 only** and each download is appended to the project's `ATTRIBUTION.md` — keep that file with the project. VO and avatar audio are generated per render and aren't redistributable stock.
