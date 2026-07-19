---
name: solene
defaultProvider: none
defaultVoice: TX3LPaxmHKxFdv7VOQHJ
font: Cormorant Garamond
labelFont: Cormorant Garamond
background: glow
backgroundIntensity: 0.2
facelessDisclosure: AI-generated voiceover
captionMode: phrase
captionStyle:
  fontSize: 60
  strokeWidth: 0
  style: minimal
  animation: blur-in
  background:
    opacity: 0.6
    appOnly: true
colors:
  night: "#F4F1EA"
  white: "#1A1712"
  mint: "#9A8459"
  green: "#9A8459"
  gold: "#B9AE97"
backgroundColors: ["#F4F1EA", "#E7E0D2", "#B9AE97"]
bannedPhrases: [buy now, best, cheap, sale, limited time, guaranteed, act fast, hurry]
---

# Solène — brand guidelines

Solène is a fictional maison of slow-made fragrance. One scent, made in small batches, aged
in stillness. The trailer sells *quiet*, not product features.

- **Voice:** hushed, editorial, unhurried. Complete sentences are optional — a single noun can be a
  line. Never sell hard; never raise your voice. Two to four words on screen at a time.
- **Look:** warm bone paper (#F4F1EA), espresso ink (#1A1712), one muted signal accent — aged
  champagne (#9A8459). Serif type, generous whitespace, nothing bold, nothing bright. The only motion
  is a slow, low glow — set `backgroundIntensity` low (≤0.25) so it breathes rather than moves.
- **Captions:** `phrase` mode, `minimal` style, `blur-in` (or `rise`) entrances — words should arrive
  the way light does, not the way ads do. Emphasise nothing loudly; let the accent colour do it once.
- **Avoid:** stroke outlines, glow captions, exclamation marks, urgency, superlatives, price talk.

_All frontmatter is optional; anything omitted uses kino defaults._
