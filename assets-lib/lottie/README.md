# Shared Lottie library

Brand-neutral, pre-cleaned LottieFiles templates (opaque backgrounds stripped, colors desaturated,
creator HSB text artifact removed — see "Sourcing from LottieFiles" in docs/motion-graphics.md).
Copy into a project's `assets/motion/` and reference from a spec like any Lottie.

- `gradient-wave.json` — 7-bar staggered wave, monochrome, transparent bg. Ambient full-beat or lower-frame band. 12s loopable.
- `event-card-carousel.json` — three event cards cycling with blur handoff. Template copy is fixed (baked glyphs). 6s.
- `product-card-carousel.json` — card-swap carousel skeleton, gray image placeholders, product copy hidden. Swap the image assets' base64 `p` to fill the slots. 10s.
- `logo-reveal.json` — masked logo reveal with ring wipe; logo slot is a transparent placeholder — replace image asset `image_0`'s base64 `p` with a brand PNG. 9s.

Regression check: `projects/showcase/specs/lottie-check.json` renders all four (`kino storyboard specs/lottie-check.json`).

## Licensing

These four were adapted from LottieFiles creator templates — cleaning them (background/HSB
removal, see above) does not change the source license. Before publishing a release that ships
this directory, confirm each template's original LottieFiles license permits redistribution
inside a public npm package. See "Sourcing from LottieFiles" in `docs/motion-graphics.md` for the
adaptation notes and the licensing caveat.
