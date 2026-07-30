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
  if (markers.grid) {
    const g = markers.grid;
    log.info(`beat grid: ${g.bpm} bpm · period ${g.periodSec}s · phase ${g.phaseSec}s · strength ${g.strength}${g.strength < 0.5 ? " (weak — sync may not read)" : ""}`);
  } else {
    log.info("beat grid: none detected (beatless or too short)");
  }
  log.ok(jsonPath);
  log.ok(wavePath);
  log.ok(spectrumPath);
}
