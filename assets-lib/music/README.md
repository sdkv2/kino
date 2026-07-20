# Shared music library

Brand-neutral beds resolvable from any spec by bare id: `"src": "ambient-night"` →
`assets-lib/music/ambient-night.mp3`. Path-like refs (`"music/bed.mp3"`) resolve from the
project's own `assets/` instead.

List beds: `kino music`. Optional copy into a project: `kino music ambient-night --get --project <name>`.

## Beds

| id | mood | use |
|---|---|---|
| `ambient-night` | dark, soft pad | sleep / wellness / night |
| `warm-drone` | low, mellow drone | calm narrative, luxury |
| `soft-piano` | gentle piano tones | editorial, reflection |
| `calm-pulse` | soft pulsing sub | breathing / habit / focus |
| `bright-lift` | brighter soft lift | product reveal, friendly SaaS |
| `chill-groove` | light groove pulse | lifestyle, casual consumer |

## Sourcing

These ship as **CC0 procedural** beds (ffmpeg-generated, no third-party samples) so agents never
need to scrape Mixkit/Pixabay/Bensound CDNs. Replace any bed with a real licensed track by
dropping an `.mp3` of the same id here, or use a project path (`"music": { "src": "music/bed.mp3" }`).

Keep beds ~30–60 s, loop-friendly, mono, 48 kHz, peaking around −6 dBFS.

## Spec pattern

```json
"music": { "src": "ambient-night", "volume": 0.14, "duck": 0.045, "fadeOutSec": 2.5 }
```

SFX is optional (no default cut whoosh). If a beat earns a soft pop/click, place it with
`kino audio-markers` on the VO track after a real build, then set `sfx[].at`.
