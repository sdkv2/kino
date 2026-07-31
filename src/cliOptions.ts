// Every flag that appears on more than one command is defined ONCE here, so a word means the same
// thing everywhere and reads identically in `--help`. Before this file the CLI had four different
// `--format`s (aspect ratio / transcript format / mask format) and four different `--out`s, which is
// exactly the kind of thing an agent guesses wrong.
//
// These are factories, not constants: Commander mutates an Option as it is attached to a command,
// so sharing one instance across commands would leak state between them.
import { Option } from "commander";

/* ─── the two mode words ──────────────────────────────────────────────────────────────────────
 * Only three words describe fidelity/cost across the whole CLI, and each means one thing:
 *   --draft   cheaper and faster than the default
 *   --real    the real voiceover, reused from cache — never buys any
 *   --tts     buy real voiceover from ElevenLabs (`build` only — the ONLY flag that spends)
 */

/**
 * Fast, low-fidelity preview. Never spends, on any command. Two texts because a draft render and a
 * draft transcript are cheap in different ways — but both open with "fast preview:" so the flag
 * reads as one idea wherever it appears.
 */
export const draftOpt = () => new Option("--draft", "fast preview: smaller canvas, quicker render, silent");
export const draftAnalysisOpt = () => new Option("--draft", "fast preview: canned output, no ffmpeg or network");

/** Real VO, cache-only. Never spends, on any command — a miss is an error, not a purchase. */
export const realOpt = () =>
  new Option("--real", "use the real voiceover cached by `build --tts` (errors if there is none)");

/** Superseded spelling of --draft. Still works; kept out of the help so only one name is taught. */
export const mockAliasOpt = () => new Option("--mock", "deprecated alias of --draft").hideHelp();

/* ─── shared nouns ───────────────────────────────────────────────────────────────────────────── */

export const projectOpt = () => new Option("--project <name>", "use projects/<name> (default: inferred from the path)");
/** Same flag, but the download commands have no spec path to infer a project from. */
export const projectTargetOpt = () =>
  new Option("--project <name>", "project whose assets/ receives the download (required with --get)");

/** Video shape. `--format` NEVER means a file/serialisation format — that is `--as`. */
export const formatListOpt = () =>
  new Option("--format <list>", "output formats: 9:16, 3:4, 16:9 — add -4k for UHD (comma-separated)");
export const formatOneOpt = () =>
  new Option("--format <fmt>", "output format: 9:16, 3:4, 16:9 — add -4k for UHD");

/**
 * File/serialisation format. Split out of `--format` so the video-shape meaning stays unique.
 * Deliberately has NO Commander default — a default would always beat the deprecated `--format`
 * in `firstOf()` and silently ignore it. Callers apply their own fallback instead.
 */
export const asOpt = (choices: string[]) => new Option("--as <fmt>", "output format").choices(choices);
/** Pre-split spelling of --as. Still works; hidden so the help teaches one name. */
export const formatAliasOpt = () => new Option("--format <fmt>", "deprecated alias of --as").hideHelp();

export const fontOpt = () => new Option("--font <name>", "override the brand font (see `kino fonts`)");

/**
 * Where output lands. Two words, split by whose filesystem you are naming:
 *   --out <dir>|<file>  a path YOU choose, anywhere on disk
 *   --name <rel>        a path INSIDE the project's assets/
 * Before the split, `--out` meant both of those plus a bare subdirectory name.
 */
export const outDirOpt = () => new Option("--out <dir>", "output directory");
export const assetNameOpt = (dflt: string) => new Option("--name <rel>", `save under assets/<rel> (default ${dflt})`);
/** Pre-split spelling of --name. Still works; hidden so the help teaches one name. */
export const outAliasOpt = () => new Option("--out <rel>", "deprecated alias of --name").hideHelp();
export const qualityOpt = () =>
  new Option("--quality <preset>", "standard (default), or very-high to supersample the composite 2×");
export const platformOpt = () =>
  new Option("--platform <name>", "overlay in-feed safe zones — a guide only: tiktok, reels, shorts");
export const dryRunOpt = () => new Option("--dry-run", "print the changes without writing the spec");

/* ─── frame selection (shared by `still` and `frames`) ───────────────────────────────────────── */

export const atOpt = () => new Option("--at <list>", "timestamps in seconds (comma-separated)");
export const aroundOpt = () => new Option("--around <sec>", "frames in a window centred on this timestamp");
export const spanOpt = () => new Option("--span <sec>", "width of the --around window in seconds (default 1)");
export const montageOpt = () => new Option("--montage", "tile the frames into one contact sheet");

/* ─── stock-search (shared by `pexels`, `photos`, `music`) ───────────────────────────────────── */

export const getOpt = () => new Option("--get <n>", "download result n into the project's assets/");
export const resultCountOpt = () => new Option("--count <n>", "how many results to list (default 8)");
export const landscapeOpt = () => new Option("--landscape", "search landscape instead of portrait");

/**
 * Fold a superseded flag into its replacement: the new spelling wins, the old one still works.
 * Returns undefined only when neither was passed, so a `??` default still applies downstream.
 */
export function firstOf<T>(...vals: (T | undefined)[]): T | undefined {
  return vals.find((v) => v !== undefined);
}
