# Shared SFX library

Brand-neutral sound effects resolvable from any spec by bare id: `"src": "whoosh"` →
`assets-lib/sfx/whoosh.mp3` (`.mp3` preferred, `.wav` accepted). Path-like refs
(`"sfx/hit.mp3"`) resolve from the project's own `assets/` instead.

## Naming

One short kebab-case id per file, named for the sound, not the use: `whoosh.mp3`,
`pop.mp3`, `ding.mp3`, `riser.mp3`, `impact.mp3`, `click.mp3`.

## Sourcing

Only CC0 / public-domain audio goes in this directory (it ships with the npm package):

- freesound.org — filter license to "Creative Commons 0"
- kenney.nl/assets — CC0 game audio packs (interface/impact sounds)
- pixabay.com/sound-effects — Pixabay license (free, no attribution)

Keep clips short (< 3 s), trimmed tight (no leading silence — `sfx.at` should be the
sound's actual start), normalized to around −1 dBFS peak, 44.1 kHz.

## Placement workflow

Run `kino audio-markers <file>` on the VO track or a music bed to get
`<name>.markers.json` (onsets/peaks/silences) plus waveform + spectrogram PNGs, then
author `sfx[].at` against those timestamps (whoosh in a silence, ding on an onset).
