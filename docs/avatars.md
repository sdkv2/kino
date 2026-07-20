# Avatars & presenters

kino renders two kinds of beat. An **avatar** beat (`kind: "avatar"`) is an on-camera AI presenter, lip-synced to the segment's voiceover. Everything else — `app` footage, `motion` graphics, faceless hero text — renders over a [background](backgrounds-and-overlays.md) with no face. One spec can mix them: only the `avatar` beats are sent to a provider, and the VO is **trimmed to just those on-camera windows** before generation, so you pay only for the talking beats.

No avatar beats (or `provider: "none"`) → a fully **faceless** build. That's a valid, cheaper default; reach for a presenter when a face earns the beat.

For the full production playbook (structure, cost discipline, compliance), see the [`video-production`](../skills/video-production/SKILL.md) skill. This page is the field reference. Commands: [`build`](cli-reference.md#build), [`avatars`](cli-reference.md#avatars), [`doctor`](cli-reference.md#doctor). Spec fields: [Spec reference](spec-reference.md#top-level-fields).

- [Choosing a provider](#choosing-a-provider)
- [The look or portrait](#the-look-or-portrait)
- [Avatar beats](#avatar-beats)
- [Provider-specific settings](#provider-specific-settings)
- [Preview cheaply](#preview-cheaply)
- [Disclosure & cost](#disclosure--cost)

## Choosing a provider

Set `provider` on the spec (or `brand.defaultProvider`). Resolution: `spec.provider` → `brand.defaultProvider` → `"none"` (faceless).

| Provider | Engine | `avatarLook` is… | Key / dep |
|---|---|---|---|
| `none` | — (faceless) | — | none |
| `heygen` | HeyGen Avatar-IV photo avatars | a **look id or alias** | `heygen` CLI + `HEYGEN_API_KEY` |
| `hedra` | Hedra Character-3 | a **portrait image** path/url | `HEDRA_API_KEY` |
| `replicate` | Open-source lip-sync (default `bytedance/omni-human`) | a **portrait image** path/url | `REPLICATE_API_TOKEN` |

Run `kino doctor` to see which keys/deps are present. HeyGen needs its CLI installed and authed; Hedra and Replicate are plain HTTP keys in `.env`.

## The look or portrait

`avatarLook` names who's on camera, and it means different things per provider:

- **HeyGen** — a photo-avatar **look id**, or an alias resolved through `brand.lookAliases`. Unknown aliases pass through as raw ids. List the drivable looks (portrait Avatar-IV photo avatars only) with `kino avatars [--gender <g>]`.
- **Hedra / Replicate** — a **portrait image** (project asset path or url). If `avatarLook` is omitted these fall back to `brand.avatarImage`. A provider that needs an image but has none fails the build with a clear error — set `brand.avatarImage` or the spec's `avatarLook`.

Brand defaults: `brand.defaultLook` (fallback look/portrait), `brand.avatarImage` (default portrait for hedra/replicate), `brand.lookAliases` (alias → id map). An avatar build with no resolvable voice **or** look fails loud rather than rendering an empty presenter.

## Avatar beats

An `avatar` segment speaks its `text` on camera:

```json
{ "kind": "avatar", "text": "Paste the job post — we rebuild the bullets.", "cta": true }
```

- **`text`** — spoken VO (required); drives lip-sync + caption timing.
- **`caption`** — on-screen line. Omit → no caption this beat (VO still speaks `text`).
- **`cta`** — avatar-only; marks the call-to-action beat.
- Also honors the shared beat controls: `shot`, `emphasis`, `caption*` overrides, `captionKeyframes`, `texts`, and `motionOverlay` (a motion graphic composited over the presenter). See [Captions](spec-reference.md#captions) and [Motion graphics](motion-graphics.md).

Mix freely with `app` and `motion` beats — the pipeline trims VO to the contiguous on-camera runs, lip-syncs only those, and stitches everything back on one timeline.

## Provider-specific settings

Overridable per brand (raw provider knobs — most brands never touch them):

- **Hedra** — `brand.hedraModelId` picks a specific Character-3 model (default: auto-selected).
- **Replicate** — the default model is `bytedance/omni-human` (image+audio talking head, boots reliably). Override with `brand.replicateModel`, and because each lip-sync model names its inputs differently, `brand.replicateImageField` / `replicateAudioField` (default `image` / `audio`) and `brand.replicateInput` (extra model inputs).

## Preview cheaply

Avatar generation is the slow, paid step. Iterate structure without it:

- **`kino build <spec> --mock`** — placeholder avatar, no API spend. Verify beats, timing, captions, layout first.
- **`kino still` / `kino storyboard`** — render frames/contact sheets without a full build (faceless/mock render).
- Real avatar output is **content-cached** on provider + look/portrait + trimmed-audio bytes: an unchanged presenter beat is reused across rebuilds, so only edited beats re-generate.

## Disclosure & cost

An AI presenter usually needs an on-screen disclosure. Set `brand.disclosure` (e.g. `"AI-generated"`) — it renders on every avatar build; `brand.facelessDisclosure` covers faceless output. Providers bill per generated second and vary in quality/price — validate the read with `--mock` and stills before spending. The [`video-production`](../skills/video-production/SKILL.md) skill carries the cost/compliance guardrails.
