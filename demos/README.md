# kino demos

The GIFs here are the showcase embedded in the root [README](../README.md) — each a real,
deterministic `kino build` of a **fictional** sample brand (trimmed, silent previews; the full
renders are faceless 9:16 MP4s with ElevenLabs voiceover):

| Preview | Demo | What it shows |
|---|---|---|
| `kino-meta.gif` | **The self-demo** | kino types its own `advert.json` and builds the ad you're watching |
| `canned-doom.gif` | **Canned Doom** | all authored motion graphics, word-synced typing — no footage |
| `lunara.gif` | **Lunara** | stock b-roll + a quiet mood read — the calm end of the range |

## Authoring workspace

`demos/` doubles as a kino workspace for building new demos: `brands/<name>/` + `projects/<name>/`
resolve from the project path, e.g. `kino build demos/projects/<name>/specs/….json` from the package
root. Source projects and Pexels assets stay local (gitignored) — commit only the trimmed showcase GIFs.

Authoring bar: follow `skills/video-production` + `ad-voice` + `adversarial-critique` — cold-open footage
first, media ≈ half runtime, ducked music, storyboard → adversarial still QA → real build.
