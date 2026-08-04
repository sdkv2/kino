/** Worker-count limits imposed by the GPU rather than by CPU cores. Pure arithmetic — the caller
 *  supplies probed values so this stays testable and free of I/O. */
export type GpuLimits = {
  /** Free VRAM in bytes, from the native addon. Undefined when unprobed or unavailable. */
  vramFreeBytes?: number;
  /** Estimated VRAM per worker. See bytesPerWorker(). */
  bytesPerWorker?: number;
  /** Concurrent NVENC sessions. NVENC cannot be queried for this — it comes from
   *  KINO_NVENC_SESSIONS, or is left undefined and surfaces as an initEncoder error. */
  sessionLimit?: number;
};

/** Calibrated on an RTX 3060 Ti (8GB, driver 580.82.09) by sweeping concurrency with the cap
 *  relaxed and sampling nvidia-smi through each render. The prior 2.6GB figure was extrapolated
 *  from an unrelated card and is ~5x too high: marginal cost is ~300MB/worker at SS=1 and
 *  ~463MB/worker at SS=2 (2160x3840 target), over a ~420MB fixed host baseline. No allocation
 *  failure occurs at any reachable concurrency — the card runs out of NVENC sessions (8) first,
 *  so the highest c that renders is 8 and vramTotal/8 = 976MB is the derived per-worker budget.
 *
 *  900MB, not the 1GB this previously rounded to. That rounding was the difference between a
 *  cap of 8 and a cap of 7 on the very card the figure was calibrated on: the card reports
 *  ~7510MB *free* rather than its nominal 8192MB, and 7510/1024 floors to 7. The calibration
 *  above concluded "the highest c that renders is 8" while the constant it produced forbade it.
 *
 *  Measured cost of that off-by-one on a second RTX 3060 Ti (8GB, driver 595.58.03, Ubuntu 22.04,
 *  shader spec at 1080x1920, KINO_ELECTRON_CAPTURE=direct): c=7 renders at 160.9 fps and c=8 at
 *  208.2 fps, so the cap was giving up 29% at its own optimum. Throughput falls off past the
 *  knee (c=12 -> 186.3, c=16 -> 110.6), and c=8 is bit-identical to c=2 (PSNR inf), so 8 is a
 *  real optimum rather than an artefact. NVENC was unreachable on that driver, which is why the
 *  session ceiling did not bind first the way it did during the original calibration — on the
 *  `direct` path there are no NVENC sessions to run out of, and VRAM is the only cap left.
 *
 *  Still conservative: 8 workers at SS=2 need ~420 + 8*463 = 4.1GB of the 7.5GB free, so 900MB
 *  remains ~1.8x the measured marginal. It also does not change the cap on a 4GB card (3 either
 *  way). Chosen from the arithmetic rather than the round number: the interval that yields
 *  exactly 8 here is (835, 939] MB.
 *
 *  Override in MB with KINO_VRAM_PER_WORKER when calibrating on other hardware. */
const DEFAULT_BYTES_PER_WORKER = 900 * 1024 * 1024;

export function bytesPerWorker(env: NodeJS.ProcessEnv = process.env): number {
  const mb = Number(env.KINO_VRAM_PER_WORKER);
  if (Number.isFinite(mb) && mb > 0) return Math.round(mb * 1024 * 1024);
  return DEFAULT_BYTES_PER_WORKER;
}

export function capWorkers(
  requested: number,
  limits: GpuLimits,
): { workers: number; reason: "requested" | "vram" | "sessions" } {
  let workers = requested;
  let reason: "requested" | "vram" | "sessions" = "requested";

  const per = limits.bytesPerWorker;
  if (limits.vramFreeBytes != null && per != null && per > 0) {
    const fits = Math.max(1, Math.floor(limits.vramFreeBytes / per));
    if (fits < workers) {
      workers = fits;
      reason = "vram";
    }
  }

  if (limits.sessionLimit != null && limits.sessionLimit >= 1 && limits.sessionLimit < workers) {
    workers = limits.sessionLimit;
    reason = "sessions";
  }

  return { workers: Math.max(1, workers), reason };
}
