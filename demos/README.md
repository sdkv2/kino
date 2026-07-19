# kino demos

Shippable mock-brand trailers for showcasing kino. Each demo is a full brand + project
under this workspace (`brands/` + `projects/`), separate from local scratch under the
repo-root `brands/` / `projects/` (those stay gitignored).

## Layout

```
demos/
  brands/<name>/brand.md
  projects/<name>/{project.json,specs/,assets/,out/}
```

kino resolves the workspace from the project path, so `kino build demos/projects/<name>/specs/….json`
works from the package root.

## Demos

| Brand | What | Spec | MP4 |
|---|---|---|---|
| **hold** | Indoor climbing beta — film, tap holds, share sequence | `projects/hold/specs/trailer.json` | `out/hold-trailer/hold-trailer-9x16.mp4` |
| **crate** | Vinyl dig companion — sleeve ID + dig log | `projects/crate/specs/trailer.json` | `out/crate-trailer/crate-trailer-9x16.mp4` |
| **swell** | Surf spot go/wait + tide windows | `projects/swell/specs/trailer.json` | `out/swell-trailer/swell-trailer-9x16.mp4` |

## Build a demo

```bash
cd /path/to/kino          # package root
npx tsx src/cli.ts doctor
npx tsx src/cli.ts build demos/projects/hold/specs/trailer.json
# → demos/projects/hold/out/hold-trailer/hold-trailer-9x16.mp4
```

Pexels clips are large — not always committed. If `assets/pexels/` is missing, re-pull with
`kino pexels "…" --get N --project <name>` from a shell whose cwd is `demos/` (or pass paths
under `demos/projects/<name>/`).

## Authoring bar

Follow `skills/video-production` + `ad-voice` + `adversarial-critique`:
cold-open footage first, media ≈ half runtime, ducked music, no default cut whooshes,
ElevenLabs `eleven_v3` default, storyboard → adversarial still QA → real build.
