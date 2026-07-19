// `kino audio-markers <file>` — agent-facing audio analysis: writes <name>.markers.json (exact
// timestamps to author sfx.at / cuts against) plus wave + spectrum PNGs (the eyeball overview).
// Works on any audio or video file: the VO track in .kino-cache, an imported music bed, anything.
import { existsSync } from "node:fs";
import { analyzeAudio } from "../media/markers.js";
import { log } from "../log.js";

export async function audioMarkers(file: string, opts: { out?: string }): Promise<void> {
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  const { markers, jsonPath, wavePath, spectrumPath } = await analyzeAudio(file, opts.out);
  log.info(
    `${markers.durationSec}s · ${markers.onsets.length} onsets · ${markers.peaks.length} peaks · ${markers.silences.length} silences`,
  );
  log.ok(jsonPath);
  log.ok(wavePath);
  log.ok(spectrumPath);
}
