# showcase

Concept demo videos for kino itself. All build with `--mock` (no API keys, silent VO):

```bash
kino build projects/showcase/specs/spec-in-video-out.json --mock   # the pitch
kino build projects/showcase/specs/feature-tour.json --mock        # backgrounds/captions/keyframes
```

`broll-cutaways.json` demos `.mp4` assets cutting into app segments (the `kino pexels` workflow).
Its b-roll is real Pexels stock (git-ignored — downloads are refetchable). Fetch the two clips
first, with `kino pexels` (`PEXELS_API_KEY` set) or directly:

```bash
mkdir -p projects/showcase/assets/pexels
curl -L -o projects/showcase/assets/pexels/35471095.mp4 \
  https://videos.pexels.com/video-files/35471095/15027338_1080_1920_60fps.mp4   # night highway
curl -L -o projects/showcase/assets/pexels/12536125.mp4 \
  https://videos.pexels.com/video-files/12536125/12536125-hd_1080_1920_25fps.mp4 # metro bridge
kino build projects/showcase/specs/broll-cutaways.json --mock
```

Footage from [pexels.com](https://www.pexels.com) (free license). The `footage-a/b.json` specs
generate synthetic dark stand-ins (kino-dark brand) if you'd rather stay fully offline.
