---
name: ad-voice
description: >-
  Write short-form ad VO, captions, and CTAs that sound human — not AI slop.
  Use when authoring or rewriting kino segment `text`/`caption`, filling a brand's
  Tone/Voice section, or when copy feels generic, corporate, or LLM-default.
---

# Ad voice (human short-form copy)

Companion to `video-production`. That skill owns beats, build, and render.
**This skill owns every spoken and on-screen word.**

## Before writing any copy

**New brand (no `brands/<name>/brand.md` yet)?** Run **Brand discovery** first (see `video-production`) —
reuse an existing brand or gather palette, voice, and assets from `brands/*`, the app's real screens, and
the owner before you write a personality. Then:

1. `kino brand <name>` — read the brand's **Tone / Voice** section (see template below).
2. If that section is empty or still scaffold text, **fill it with the brand owner** (or draft from product truth + ask for approval) before mass-producing specs.
3. Apply **brand tone first**, then the house rules in this skill. Brand bans win over house defaults.

## Brand Tone / Voice (per-brand dial)

Lives in `brands/<name>/brand.md` **guidelines body** (not frontmatter — kino never parses tone).
`kino init` scaffolds this. Agents must respect filled fields; never invent a personality that contradicts them.

```markdown
## Tone / Voice

- **Register:** <casual | plain | sharp | warm | dry> — how close to UGC vs broadcast
- **Person:** <you | we | they> — who the VO addresses (pick one; stay consistent)
- **Pace:** <punchy | measured> — sentence length + pause density
- **Energy:** <low | medium | high> — matches ElevenLabs voice + avatar, not hype adjectives
- **Proof style:** <specific numbers | social proof | demo-first | none>
- **CTA style:** <direct | soft recommend | urgency> — still name the action
- **Say like this:** 2–4 sample lines on-voice (real product truth)
- **Never say like this:** 2–4 off-voice lines (same claim, wrong tone)
- **Banned (brand):** phrases this brand never uses (beyond kino `bannedPhrases`)
- **Preferred words:** product nouns / verbs this brand actually says
```

**Dial, don't decorate.** `"confident, approachable, innovative"` is useless. Contrasting on/off examples + bans is what steers the model.

## House defaults (when brand is silent)

Short-form cold traffic (TikTok / Reels / Shorts), 2025–2026 winners:

| Lever | Default |
|---|---|
| Sound | Conversational, creator-native — friend explaining, not announcer |
| Hook | Pattern interrupt in first 1–3s — problem, contrarian claim, or curiosity gap. **Never** brand-name opener. Pair the line with a visual cold open when footage exists (see `video-production` opener menu) — copy alone on a soft mesh rarely stops the scroll |
| Body | Concrete demo / proof; one idea per beat |
| CTA | Specific verb + outcome (`Try free — no card`, not `Learn more`) |
| Length | ~15–30s; ~2–3 words/sec spoken; captions shorter than VO |

Frameworks (pick one; don't stack labels in the script):

- **PAS** — Problem → Agitate → Solution (+ CTA). Default for clear pain.
- **Hook → Demo → Proof → CTA** — footage-led apps.
- **BAB** — Before → After → Bridge. Clear transformation only.

## Anti-slop rules (non-negotiable)

1. **Specific > adjective.** Replace every vague modifier with a number, time, comparison, or observable action.
2. **Speakable.** Read aloud. If it sounds like a landing page, rewrite. Contractions OK. Fragments OK.
3. **One claim per beat.** No "and also" laundry lists in a single `text`.
4. **No LLM throat-clearing.** Cut openers that announce thinking (`Here's the thing`, `The truth is`, `In today's…`).
5. **Max one superlative per spec** unless the brand's proof style demands a named benchmark.
6. **Could a competitor paste this?** If yes, add product-specific detail or kill the line.
7. **Captions ≠ VO dump.** Caption = the one line a silent scroller needs; VO can carry the rest.
8. **Respect brand `bannedPhrases`.** Brand bans still fail the build when set.

### Hard-banned vocabulary (house list)

Never in VO, captions, kickers, or `texts` overlays unless the brand explicitly overrides:

`unlock` · `unleash` · `elevate` · `empower` · `revolutionize` · `transform your` · `supercharge` ·
`seamless` / `seamlessly` · `effortless` / `effortlessly` · `streamline` · `cutting-edge` ·
`next-generation` / `next-gen` · `game-changing` · `innovative` · `world-class` · `state-of-the-art` ·
`robust` · `powerful` (alone) · `comprehensive` · `AI-powered` / `AI-native` (unless product *is* the AI claim — then name the capability) ·
`all-in-one` · `the future of` · `take X to the next level` · `don't get left behind` ·
`the choice is yours` · `look no further` · `in today's fast-paced` · `it is important to note` ·
`dive in` / `dive deep` · `delve` · `leverage` · `synergy` · `best-in-class` · `utilize`

Weak CTAs — rewrite: `get started` · `learn more` · `sign up free` · `join us` · `check it out`

Full patterns + rewrites → [reference.md](reference.md).

## Writing workflow

```
1. Read brand Tone / Voice
2. Pick framework (PAS / demo / BAB)
3. Draft hook (3–5 variants if testing; ship one)
4. Draft beat texts + short captions
5. Slop pass — scan against banned list + brand Never-say
6. Speak pass — read full VO start→finish; cut redundancy across beats
7. Only then: kino inspect / storyboard
```

Cross-beat check (from video-production) still applies: motion labels and captions must not repeat the same phrase.
When VO enumerates on-screen steps (pipeline chips, tiles), **speak the same nouns the UI shows** —
mismatched pairs (`compose` on screen / "motion" spoken) read as bugs, not style.

## Quick rewrites

| Slop | Human |
|---|---|
| Unlock your potential with our seamless AI-powered platform | Paste a job post. Get a tailored CV in about twenty minutes. |
| Revolutionize the way you job hunt | Stop sending the same CV to every listing. |
| Get started today | Try it free — link below |
| Take your career to the next level | Land callbacks for roles that actually match |

## Hook menu (steal structure, not words)

- Pain, named: "Still rewriting your CV for every job?"
- Contrarian: "Your cover letter isn't too short. It's too vague."
- Specific result: "One edit. Three more callbacks this week."
- Curiosity + demo: "Watch what happens when you paste the job post in."
- Stop command: "Stop sending the same PDF everywhere."

## CTA rules

- Name the action + the immediate next step.
- Soft brands: recommend (`Seriously — just try the free run`) still beats vague.
- Urgency only with a real reason (trial length, limited seats) — never fake scarcity.
- Put brand name + URL on the CTA beat (`cta: true`), not in the hook.

## When revising "sounds AI" feedback

1. Highlight every adjective / adverb → delete or replace with proof.
2. Break polished compound sentences into 2–3 spoken lines.
3. Swap framework openers that telemarketer UGC overuses (`I was struggling with…`, `That's when I found…`) for a concrete trigger moment.
4. Re-read brand **Say / Never say** examples; mirror syntax, not just vibe words.
