# motion-ui — speech-synced UI pages

Showcase of the **Tier 2** prompt / editor / terminal / loop-ready pages extracted
from the kino advert. Canonical sources live in
[`assets-lib/motion/`](../../assets-lib/motion/):

| Library file | Role |
|---|---|
| `prompt-type.js` | Typed prompt window + camera push |
| `json-type.js` | JSON editor typing across the VO span |
| `build-pipeline.js` | Terminal command + word-synced pipeline steps |
| `loop-ready.js` | Settle to empty ready-state (loop seam) |

## Use in a project

```bash
mkdir -p projects/<name>/assets/motion
cp assets-lib/motion/{prompt-type,json-type,build-pipeline,loop-ready}.js \
  projects/<name>/assets/motion/
```

Then in a spec (omit `caption` — the graphic owns the type):

```json
{ "kind": "motion", "source": "motion/prompt-type.js",
  "text": "Make me an advert." }
```

Edit knobs at the top of each file (`MARK`, `CMD`, `LINES`, `STEPS`, `FILENAME`)
before or after copying. Use `voiceModel: "eleven_multilingual_v2"` when typing
must lock to VO. Full playbook: `speech-synced-ui` skill.

## Render verification stills

```bash
npx tsx examples/motion-ui/render-ui.ts            # stills → examples/motion-ui/out/
FLEX_VIDEO=1 npx tsx examples/motion-ui/render-ui.ts   # short 9:16 mp4
```

`render-ui.ts` loads the library files directly (no copy) and feeds mock
`env.words` so typing/pipeline light without a real VO pass.
