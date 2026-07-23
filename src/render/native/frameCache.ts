// Persistent per-frame capture cache. Every rendered frame is a pure function of its index
// (the engine's core contract), so a captured JPEG can be reused by any later build as long as
// nothing that feeds that frame's pixels changed. Each frame gets a signature: a hash of the
// global config (dimensions, fps, page bundle, avatar, non-segment props) plus every segment
// whose padded range covers the frame — the pad absorbs transition overlaps, so editing a beat
// also invalidates the frames of its crossfade neighbors. Audio never touches the signature:
// music/mix changes re-encode but reuse every captured frame.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import type { KinoProps } from "../props.js";

// Longest pixel bleed across a beat boundary: 24-frame dissolve entry / 15-frame motion xfade /
// 12-frame chained-app extension — 30 covers all with margin.
const PAD = 30;
const VERSION = 2;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");

// Content identity for media files by size alone: the build re-stages assets into _public on
// every run, so mtime churns even when bytes don't. Size-only is enough for footage that only
// ever changes by being replaced with a different file; ponytail: hash bytes if that ever lies.
// Missing files hash as absent (the media layer already tolerates that).
function statSig(abs: string): string {
  try {
    return String(statSync(abs).size);
  } catch {
    return "absent";
  }
}

/** Per-frame pixel signatures for the whole composition. */
export function frameSignatures(opts: {
  props: KinoProps;
  publicDir: string;
  pageJsHash: string;
  width: number;
  height: number;
  total: number;
  fps: number;
  /** GL backend — gpu/sw frames must not cross-serve (default from KINO_GPU). */
  mode?: "gpu" | "sw";
  /** Shader/glass supersample factor — SS=1 vs 2 are different pixels. */
  shaderSS?: number;
  /** FXAA edge post-pass on/off — different pixels. */
  shaderFXAA?: boolean;
}): string[] {
  const { props, publicDir, pageJsHash, width, height, total, fps } = opts;
  const mode = opts.mode ?? (process.env.KINO_GPU === "1" ? "gpu" : "sw");
  const shaderSS = opts.shaderSS ?? 2;
  const shaderFXAA = opts.shaderFXAA ?? true;
  const f = (s: number) => Math.round(s * fps);
  const globalSig = sha1(
    JSON.stringify({
      v: VERSION,
      width,
      height,
      fps,
      total,
      pageJsHash,
      mode,
      shaderSS,
      shaderFXAA,
      avatar: props.avatar ? statSig(join(publicDir, props.avatar)) : "none",
      props: { ...props, segments: undefined, music: undefined },
    }),
  );
  const ranges = props.segments.map((s) => ({
    from: f(s.startSec) - PAD,
    to: f(s.endSec) + PAD,
    sig: sha1(JSON.stringify(s) + ("asset" in s && s.asset ? `|${statSig(join(publicDir, s.asset))}` : "")),
  }));
  const sigs: string[] = new Array(total);
  for (let n = 0; n < total; n++) {
    let acc = globalSig;
    for (const r of ranges) if (n >= r.from && n < r.to) acc += r.sig;
    sigs[n] = sha1(acc);
  }
  return sigs;
}

export interface FrameCache {
  get(n: number): Promise<Buffer | null>;
  put(n: number, buf: Buffer): Promise<void>;
  /** Persist the manifest and prune files no build references anymore. Call after a successful encode. */
  commit(): void;
  hits: number;
}

interface Manifest {
  version: number;
  sigs: Record<string, string>; // frame index → signature of the stored JPEG
}

const frameFile = (n: number) => `f${String(n).padStart(6, "0")}.jpg`;

/**
 * Open the on-disk cache for one format. `sigs` are this build's per-frame signatures; a stored
 * frame is served only when its recorded signature matches. Disable with KINO_NO_FRAME_CACHE=1.
 */
export function openFrameCache(dir: string, sigs: string[]): FrameCache {
  if (process.env.KINO_NO_FRAME_CACHE) {
    return { get: async () => null, put: async () => {}, commit: () => {}, hits: 0 };
  }
  mkdirSync(dir, { recursive: true });
  let stored: Manifest = { version: VERSION, sigs: {} };
  try {
    const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
    if (m.version === VERSION) stored = m;
  } catch {
    // no manifest / unreadable → cold cache
  }
  const next: Manifest = { version: VERSION, sigs: {} };
  const cache: FrameCache = {
    hits: 0,
    async get(n) {
      if (stored.sigs[n] !== sigs[n]) return null;
      try {
        const buf = await fsp.readFile(join(dir, frameFile(n)));
        next.sigs[n] = sigs[n];
        cache.hits++;
        return buf;
      } catch {
        return null;
      }
    },
    async put(n, buf) {
      await fsp.writeFile(join(dir, frameFile(n)), buf);
      next.sigs[n] = sigs[n];
    },
    commit() {
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(next));
      const keep = new Set(Object.keys(next.sigs).map((n) => frameFile(Number(n))));
      for (const f of readdirSync(dir)) {
        if (f.startsWith("f") && f.endsWith(".jpg") && !keep.has(f)) rmSync(join(dir, f), { force: true });
      }
    },
  };
  return cache;
}
