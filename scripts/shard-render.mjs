#!/usr/bin/env node
// Render a queue of specs by running several `kino build` processes at once.
//
// Why this exists: one Electron instance stops scaling well before the machine does. All of a
// build's workers share a single Chromium GPU process, and their command streams and WebCodecs
// readbacks serialise through it, so per-instance throughput plateaus around 180-210 fps no matter
// what GPU is underneath — measured within that same band on an M4, an RTX 3060 Ti and an RTX 4090.
// Running N separate builds sidesteps that ceiling entirely, because each one gets its own GPU
// process:
//
//   RTX 3060 Ti, 23 vCPU   1 build (c=8): 170-175 fps    3 builds (c=4): 246 fps aggregate
//   RTX 4090,    61 vCPU   1 build (c=8): ~190 fps       8 builds (c=4): 578 fps aggregate
//
// The ceiling you hit instead is the machine's: CPU on the 3060 Ti (23.3 of 23 cores at 3 builds),
// GPU on the 4090 (99% at 8 builds). Both are better places to be than an architectural limit.
//
// This does NOT speed up a single video — it raises total throughput for a batch. One build's
// frames still go through one instance.
//
// Usage:
//   node scripts/shard-render.mjs specs/a.json specs/b.json [...] [options]
//   node scripts/shard-render.mjs 'projects/*/specs/*.json' --shards 4
//
// Options:
//   --shards N        concurrent builds (default: derived from CPU count)
//   --concurrency C   workers inside each build (default 4 — the measured per-instance sweet spot)
//   --format F        passed through to kino build
//   --draft           passed through to kino build
//   --dry-run         print the plan and exit
import { spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import { existsSync, readFileSync } from "node:fs";

/** Cores this process may actually use. `availableParallelism()` alone is wrong on rented boxes:
 *  it reports the CPU affinity mask, which a CPU-quota'd container does not restrict. Measured on
 *  a vast.ai container limited to 23 cores (cgroup v1, quota 2304000/100000) on a 192-core host,
 *  it answers 192 — which would shard 8x too wide. Mirrors usableCores() in
 *  src/render/native/sandbox.ts; duplicated because this script runs straight from source, before
 *  any build. */
function usableCores() {
  const parallelism = availableParallelism();
  for (const [quotaPath, periodPath] of [
    ["/sys/fs/cgroup/cpu.max", null], // v2: "<quota|max> <period>" in one file
    ["/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "/sys/fs/cgroup/cpu/cpu.cfs_period_us"], // v1
  ]) {
    try {
      const raw = readFileSync(quotaPath, "utf8").trim();
      const [q, p] = periodPath ? [raw, readFileSync(periodPath, "utf8").trim()] : raw.split(/\s+/);
      if (q === "max") return parallelism;
      const n = Number(q) / Number(p);
      if (Number.isFinite(n) && n > 0) return Math.max(1, Math.min(parallelism, Math.floor(n)));
    } catch {
      // not this cgroup version; try the next
    }
  }
  return parallelism;
}

const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["shards", "concurrency", "format"]);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);
// Positional args only. Skipping the value that follows a value-taking flag matters: without it
// `--shards 2` contributes a bare "2" that gets treated as a spec path.
const specs = args.filter((a, i) => {
  if (a.startsWith("--")) return false;
  const prev = args[i - 1];
  return !(prev?.startsWith("--") && VALUE_FLAGS.has(prev.slice(2)));
});

if (!specs.length) {
  console.error("usage: node scripts/shard-render.mjs <spec.json> [more specs…] [--shards N] [--concurrency C]");
  process.exit(1);
}
const missing = specs.filter((s) => !existsSync(s));
if (missing.length) {
  console.error(`spec not found: ${missing.join(", ")}`);
  process.exit(1);
}

const concurrency = Number(flag("concurrency", 4));
// ~1.75 cores per worker, i.e. ~7 per c=4 build. Fitted to the two measured optima rather than
// guessed: 23 cores -> 3 builds (measured best; 4 was slower) and 61 cores -> 8 builds (measured
// best) both fall out of this exactly. Cap at the spec count, since extra shards would just idle.
const cores = usableCores();
const autoShards = Math.max(1, Math.floor(cores / Math.max(1, concurrency * 1.75)));
const shards = Math.min(specs.length, Number(flag("shards", autoShards)));

const passthrough = [];
if (flag("format", null)) passthrough.push("--format", flag("format", null));
if (has("draft")) passthrough.push("--draft");

console.log(
  `${specs.length} spec(s), ${shards} concurrent build(s), KINO_CONCURRENCY=${concurrency} ` +
    `(${cores} cores available)`,
);
if (has("dry-run")) {
  specs.forEach((s, i) => console.log(`  [${i}] ${s}`));
  process.exit(0);
}

/** fps for one build, from the KINO_NATIVE_DEBUG laps. `frames` and `pages-boot` are both
 *  cumulative from process start, so the render itself is the difference — timing the whole CLI
 *  would fold in media extraction and audio, which do not scale with workers. */
function parseFps(output) {
  const frames = output.match(/\[native timing\] frames \S+ \((\d+)\/(\d+) cached\) \+(\d+)ms/);
  const boot = output.match(/\[native timing\] pages-boot \S+ \+(\d+)ms/);
  if (!frames || !boot) return null;
  const cached = Number(frames[1]);
  const total = Number(frames[2]);
  const ms = Number(frames[3]) - Number(boot[1]);
  if (!(ms > 0)) return null;
  // Cache hits are not renders. A re-run of an already-built spec reports four-digit "fps" that
  // measures disk, so the caller has to know before quoting the number — set KINO_NO_FRAME_CACHE=1
  // when benchmarking.
  return { frames: total, cached, renderMs: ms, fps: total / (ms / 1000) };
}

function runOne(spec) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn("node", ["dist/cli.js", "build", spec, ...passthrough], {
      env: { ...process.env, KINO_CONCURRENCY: String(concurrency), KINO_NATIVE_DEBUG: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => {
      const lap = parseFps(out);
      resolve({ spec, code, wallMs: Date.now() - started, ...(lap ?? {}), out });
    });
  });
}

const queue = [...specs];
const results = [];
const t0 = Date.now();

async function worker() {
  while (queue.length) {
    const spec = queue.shift();
    const r = await runOne(spec);
    results.push(r);
    const cacheNote = r.cached ? ` [${r.cached}/${r.frames} from cache]` : "";
    const label = r.code === 0 ? (r.fps ? `${r.fps.toFixed(1)} fps${cacheNote}` : "done") : `FAILED (exit ${r.code})`;
    console.log(`  ${r.spec} — ${label}, ${(r.wallMs / 1000).toFixed(1)}s wall`);
  }
}

await Promise.all(Array.from({ length: shards }, worker));

const wall = (Date.now() - t0) / 1000;
const ok = results.filter((r) => r.code === 0);
const failed = results.filter((r) => r.code !== 0);
const withFps = ok.filter((r) => r.fps);
const totalFrames = withFps.reduce((a, r) => a + r.frames, 0);

console.log(`\n${ok.length}/${results.length} built in ${wall.toFixed(1)}s wall`);
if (withFps.length) {
  // Two different questions, so two numbers — reporting either alone misleads.
  //
  // `render` sums each build's render-phase fps. That is what measures the sharding win, and what
  // the numbers in docs/build-and-preview.md are, so it is the one to compare against them. It
  // assumes the builds overlapped; when they did not (fewer specs than shards, or wildly uneven
  // spec lengths) it flatters the result.
  //
  // `end-to-end` is total frames ÷ wall clock: what the queue actually delivered, including media
  // extraction, page boot, audio and encode flush. On short specs those fixed costs dominate and
  // this lands far below the render figure — that is real, not an error.
  const sorted = withFps.map((r) => r.fps).sort((a, b) => a - b);
  console.log(
    `render ${withFps.reduce((a, r) => a + r.fps, 0).toFixed(0)} fps summed ` +
      `(median ${sorted[Math.floor(sorted.length / 2)].toFixed(1)}/build) · ` +
      `end-to-end ${(totalFrames / wall).toFixed(0)} fps (${totalFrames} frames incl. extract+boot)`,
  );
  const cachedTotal = ok.reduce((a, r) => a + (r.cached ?? 0), 0);
  if (cachedTotal) {
    console.log(
      `! ${cachedTotal}/${totalFrames} frames came from .frame-cache — the fps above measure cache ` +
        `reads, not rendering. Re-run with KINO_NO_FRAME_CACHE=1 to benchmark.`,
    );
  }
}
for (const f of failed) {
  console.error(`\n--- ${f.spec} failed (exit ${f.code}):`);
  console.error(
    f.out
      .split("\n")
      .filter((l) => /error|✗|Error/i.test(l))
      .slice(0, 3)
      .join("\n") || f.out.split("\n").slice(-5).join("\n"),
  );
}
process.exit(failed.length ? 1 : 0);
