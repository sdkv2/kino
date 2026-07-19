---
name: kino
font: "Inter"
labelFont: "IBM Plex Mono"
defaultProvider: none
defaultVoice: "21m00Tcm4TlvDq8ikWAM" # calm narrator
background: mesh
colors:
  night: "#0b1020"
  mint: "#80e2b4"
  green: "#0c8d64"
  white: "#ffffff"
  gold: "#d99a20"
logo: projects/kino-meta/assets/gen/04-cta-endcard.png
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

## Tone / Voice

- **Register:** plain — a calm, cinematic narrator who already trusts the
  product; broadcast-confident, never UGC-hype
- **Person:** you
- **Pace:** measured — short declaratives, with room to land between them
- **Energy:** low — confidence reads as restraint, not adrenaline
- **Proof style:** demo-first — the real spec, the real terminal, the real
  render are the proof; no testimonial, no fabricated stat
- **CTA style:** direct — name the command, not a vague next step
- **Say like this:**
  - "An agent writes the spec. One command renders the video."
  - "No timeline to drag. No editor to learn. Just JSON, and a build."
  - "This wasn't shot. It was built — from a spec like this one."
- **Never say like this:**
  - "Unleash the future of AI-powered video creation, effortlessly."
  - "Revolutionize your content pipeline with our seamless, game-changing platform."
  - "The ultimate all-in-one video solution creators have been waiting for."
- **Banned (brand):** magic, AI magic, one click, drag-and-drop, no-code,
  influencer, viral (beyond kino's house `bannedPhrases` list)
- **Preferred words:** agent, spec, build, render, voiceover, terminal,
  deterministic, JSON, command
- **Opening:** never the brand name — cold-open on the demo, the prompt, or
  the reveal; "kino" lands mid-script or on the CTA, never the hook

_All frontmatter is optional; anything omitted uses kino defaults._
