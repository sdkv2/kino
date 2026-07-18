# showcase

Concept demo videos for kino itself. All build with `--mock` (no API keys, silent VO):

```bash
kino build projects/showcase/specs/spec-in-video-out.json --mock   # the pitch
kino build projects/showcase/specs/feature-tour.json --mock        # backgrounds/captions/keyframes
```

`broll-cutaways.json` demos `.mp4` assets cutting into app segments (the `kino pexels` workflow).
Its b-roll is generated (git-ignored) — regenerate it first:

```bash
kino build projects/showcase/specs/footage-a.json --mock
kino build projects/showcase/specs/footage-b.json --mock
mkdir -p projects/showcase/assets/broll
cp projects/showcase/out/footage-a/footage-a-9x16.mp4 projects/showcase/assets/broll/clip-a.mp4
cp projects/showcase/out/footage-b/footage-b-9x16.mp4 projects/showcase/assets/broll/clip-b.mp4
kino build projects/showcase/specs/broll-cutaways.json --mock
```

With a `PEXELS_API_KEY` set, replace the synthetic clips with real stock:
`kino pexels "city commute at night" --get 1 --project showcase`.
