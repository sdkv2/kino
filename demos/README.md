# kino demos

The `*.gif` files are the silent previews embedded in the root [README](../README.md); the full renders
**with ElevenLabs voiceover** are hosted as MP4s on Cloudflare R2 (linked from the README's showcase
table, kept out of the repo). Each is a real, deterministic `kino build` of a **fictional** sample brand
(faceless, 9:16):

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
