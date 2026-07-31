---
name: kino
font: "Inter"
labelFont: "IBM Plex Mono"
defaultProvider: none
defaultVoice: "21m00Tcm4TlvDq8ikWAM" # calm narrator
background: mesh
colors:
  bg: "#0b1020"
  fg: "#ffffff"
  accent: "#80e2b4"
  accent2: "#d99a20"
  deep: "#0c8d64"
---

# kino

Agent-driven short-form video production. An agent authors a JSON spec; kino
renders it deterministically — ElevenLabs VO, optional avatar or a faceless
background, composited in Remotion to a 9:16 MP4.

**Spec defaults for this brand:** every spec sets `voiceModel: "eleven_multilingual_v2"`
(metronome-stable timing — required when on-screen text is locked to the VO) and
`film: 0` (flat; no vignette/grain — the finish is hand-rolled inside each motion
graphic instead). Both are spec-level fields in kino's schema — there is no
brand-level default for either yet, so pin them on every spec explicitly rather
than relying on this file.

_All frontmatter is optional; anything omitted uses kino defaults._
