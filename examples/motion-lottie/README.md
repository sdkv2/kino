# motion-lottie — Tier 3 Lottie fixtures

Two small, hand-authored Lottie JSON files used as reference fixtures for kino's **Tier 3**
motion-graphic engine (embedded Lottie animations, played via `@remotion/lottie`). They're also
the render fixtures for [`tests/render-lottie.test.ts`](../../tests/render-lottie.test.ts).

| File | Shape |
|---|---|
| [`fade.json`](fade.json) | A background layer that fades in/out over the full 120-frame (2s @ 60fps) duration — minimal example of an ambient, full-beat Lottie. |
| [`pop.json`](pop.json) | A short (~0.4s @ 30fps) magenta burst — minimal example of a one-shot Lottie fired by a `triggers` action (see `motion.loop` in the [spec reference](../../docs/spec-reference.md#motion-segment)). |

These are intentionally tiny — they exist to pin down the JSON shape kino expects (`layers`,
keyframed `ks.o`/`ks.p`, etc.), not to be production-ready animations. For real, brand-neutral
Lottie templates to drop into a project, see the shared library at
[`assets-lib/lottie/`](../../assets-lib/lottie/) and the sourcing/adaptation notes in
[Motion graphics](../../docs/motion-graphics.md#sourcing-from-lottiefiles).
