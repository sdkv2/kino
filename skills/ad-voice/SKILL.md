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
2. **Tone written as prose (not the dial fields) is finished, not scaffold.** Many real brands express
   voice as a paragraph — punchy ones (Duolingo) and editorial ones (Aesop, "a botanist who reads
   poetry") alike — with no Register/Person/Pace fields and no Say/Never-say pair. Map that prose to
   the dial yourself and write (a *punchy* prose brand still lands on the House defaults; only a mood
   brand trips the Quiet branch below); do **not** treat a missing dial as empty or block on an owner. Only the literal `kino init`
   placeholder counts as scaffold — if you hit that, fill it with the brand owner (or draft from product
   truth + ask for approval) before mass-producing specs.
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

## Quiet / editorial / luxury brands (mood, not conversion)

**Use this branch when** the brand reads as a **calm mood piece** — dial `Energy: low` / `Pace: measured`,
or prose that sells a *calm, unhurried feeling* (not a rush) and avoids urgency (the same "mood brand"
test as *Before writing any copy* step 2). A lone `Proof style: none` is **not** the trigger: an **attitude brand** (`Proof: none`
\+ `Energy: high` — a brash/loud spoof brand) has no numeric proof either but stays firmly on the punchy
House defaults; attitude *replaces* proof, it does not go quiet. When the branch applies:

- **Be specific through the senses.** Satisfy anti-slop #1 with observable action + concrete nouns
  (`press the seed`, `warmed between the hands`). One real product-truth number is fine (a `ten-minute`
  ritual) — the ban is on *invented* metrics and promised outcomes, not on facts.
- **Framework — Vignette / tone-poem:** mood open → material → use → sign-off. No pain, no urgency verb.
- **Hooks name a moment, not a pain:** `Before the day asks anything of you,` /
  `A small ceremony, kept at the basin.`
- **CTA is a soft act, not an install push:** name a real act without urgency — retail (`Aesop. Find a
  store, when you're ready.`) or, for an **app**, a quiet in-app moment (`Lunara. Open it tonight.`) —
  never `Download now`. Person may shift maker↔reader on purpose (we make / you keep), a deliberate glide.

**Worked example** (predicate: `Proof style: none`; brand.md "sell the ritual, never the outcome").
Brand: *Ora*, single-origin tea.

- **0 hook** (a moment, not a pain) — VO: "Before the first email, there is water." · caption: `first, water`
- **1 material** (sensory action, no metric) — VO: "We open the leaves slowly, in the heat." · caption: `opened slowly`
- **2 use** — VO: "Held in both hands, and not rushed." · caption: `both hands`
- **3 CTA** (awareness, no URL) — VO: "Ora. Find a tin at your grocer." · caption: `at your grocer`

Passes because: `we` (make) → `you` (hold) shifts on purpose; no invented metrics or superlatives; every
line names an observable act, not a promised outcome.

## Anti-slop rules (non-negotiable)

1. **Specific > adjective.** Replace every vague modifier with a number, time, comparison, or observable
   action. *(A number is one way to be specific, not the only one — for `Proof style: none` / mood brands,
   satisfy this with sensory action + concrete nouns, never an invented metric. See Quiet / editorial brands.)*
2. **Speakable.** Read aloud. If it sounds like a landing page, rewrite. Contractions OK. Fragments OK.
3. **One claim per beat.** No "and also" laundry lists in a single `text`.
4. **No LLM throat-clearing.** Cut openers that announce thinking (`Here's the thing`, `The truth is`, `In today's…`).
5. **Max one superlative per spec** unless the brand's proof style demands a named benchmark.
6. **Could a competitor paste this?** If yes, add product-specific detail or kill the line.
7. **Captions ≠ VO dump.** Caption = the one line a silent scroller needs; VO can carry the rest.
8. **Respect brand `bannedPhrases`.** Brand bans still fail the build when set.

## The AI-cadence tells (rhythm, not vocabulary)

The banned list kills *corporate* slop. The tell that still reads "AI" after that is **cadence** — copy
that's grammatically clean but where every line is a balanced, polished tagline. Real speech is lumpy.
A script can pass every rule above and still sound like a machine wrote it. Hunt these:

1. **Rule of three.** AI reaches for tricolons and triplet lists — "Nail a lesson, bank the XP, level up",
   "upload, build, boot, live", "Tabata, EMOM, AMRAP", "No ads. No login. Nothing between you and X."
   **Max one triplet per script**; usually cut it to two. Three balanced items in a row is the loudest tell.
2. **The em-dash drumroll.** "Real talk — nobody…", "push your repo — that's the whole deploy." The
   em-dash-as-pause-before-the-punchline is an AI signature. Use a period, or just say the thing.
3. **Relentless parallelism.** Every line the same shape ("press the seed, and steep the leaf" / "made for
   the skin, and for the mind" / "warmed in the hands, and drawn in slowly") reads machine-generated even
   when each line is pretty. **Vary the shape** — a run-on next to a two-word line; one flat plain statement
   among the crafted ones.
4. **Every line a tagline.** Real talk has filler, asymmetry, an unfinished thought, a plain fact stated
   plainly. If all N lines could be posters, none sound spoken. Let at least one just *say the thing*.
5. **Forced cleverness.** Similes and rhyme-y pairs you'd never say out loud — "hits your thirst like
   thunder", "recycle the corpse", "sip like a menace". Edge is not writing a riddle; blunter is more human.
6. **UGC-cliché openers.** "Real talk", "Let's be honest", "POV:", "Nobody talks about…" — the TikTok
   version of throat-clearing (rule 4 above). Open on the actual thing.

**The test that catches all of it:** read the script aloud as a **voice memo to one friend** about the app —
not a pitch, not a caption. Any line that snaps back into ad-copy is the tell; rewrite it the way you'd
actually say it. (This is stronger than "read aloud" — the *friend* frame is what exposes the polish.)

| AI cadence | Said like a human |
|---|---|
| Nail a lesson, bank the XP, level up. | Do one lesson. Watch the streak climb. |
| It hits your thirst like thunder. | Tastes kind of violent. You'll like it. |
| Real talk — nobody sits down for a language class anymore. | Who's actually sitting down for a language class? |
| Press the seed, and steep the leaf. | It starts with a seed. |
| No ads. No login wall. Nothing between you and the next round. | No ads, no login. Just the timer. |

### Hard-banned vocabulary (house list)

Never in VO, captions, or `texts` overlays unless the brand explicitly overrides:

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
