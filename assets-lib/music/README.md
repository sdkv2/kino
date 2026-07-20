# Shared music library

Ships **empty** (no bundled beds). A bare id in a spec (`"src": "my-bed"` →
`assets-lib/music/my-bed.mp3`) resolves from CC0 `.mp3` files you drop here.
The usual route is a project asset path instead (`"music/bed.mp3"` resolves from
the project's own `assets/`), or `kino music "soft ambient pad loop"` to search
Freesound (CC0, 15–90s) straight into a project.

Keep beds ~30–60 s, loop-friendly, mono, 48 kHz, peaking around −6 dBFS.

## Spec pattern

```json
"music": { "src": "music/bed.mp3", "volume": 0.14, "duck": 0.045, "fadeOutSec": 2.5 }
```

SFX is optional (no default cut whoosh). If a beat earns a soft pop/click, place it with
`kino audio-markers` on the VO track after a real build, then set `sfx[].at`.
