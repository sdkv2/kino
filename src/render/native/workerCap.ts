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
 *  1GB is that derived figure rounded up: ~2x the measured marginal cost, which leaves headroom
 *  for sources larger than the 1080p asset measured here, while no longer capping an 8GB card
 *  below the electron default of 4 workers (it fits 7).
 *
 *  Override in MB with KINO_VRAM_PER_WORKER when calibrating on other hardware. */
const DEFAULT_BYTES_PER_WORKER = 1024 ** 3;

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
