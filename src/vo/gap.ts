// The fixed pause between beats, in seconds.
//
// A leaf module on purpose: vo.ts owns the timing pipeline but drags in ffmpeg, ElevenLabs and
// whisper, so anything that only needs the number (preview/inspect, docs, tests) can import it here
// without pulling the render/TTS world in behind it. vo.ts re-exports it, so `import { GAP } from
// "../vo/vo.js"` keeps working.
//
// Two different lengths follow from this, and conflating them is a live authoring trap:
//
//   · AUDIO — each beat's voiceover occupies exactly its own duration, and the next beat's audio
//     starts GAP seconds later (see computeTimings). The gap is silence between clips.
//
//   · VISUALS — every beat except the last is held on screen until the NEXT beat starts, so nothing
//     blinks off during that silence (build.ts, `endSec`). Its rendered length is therefore
//     `dur + GAP`, and `--progress` spans that longer span, not the authored `dur`.
//
// So a motion beat authored with `"dur": 3.4` renders for 3.72s, and a keyframe at `at: 3.25` lands
// at 87% of the beat rather than 96%. The last beat gets no trailing gap. `kino inspect` always
// reports the rendered length (`durSec`), which is the number to derive `--around` times from.
export const GAP = 0.32;
