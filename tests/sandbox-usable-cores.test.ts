import { describe, it, expect } from "vitest";
import { cgroupCpuLimit, usableCores } from "../src/render/native/sandbox.js";

// The numbers below are not invented: they were read off a vast.ai container on 2026-08-04 that
// advertised 192 cores through every Node API while being limited to 23. Sizing a process pool off
// availableParallelism() there over-commits by 8x, which is why this probe exists.
const missing = (): string => {
  throw new Error("ENOENT");
};
const from = (files: Record<string, string>) => (p: string) => {
  const v = files[p];
  if (v == null) throw new Error(`ENOENT ${p}`);
  return v;
};

describe("cgroupCpuLimit", () => {
  it("reads a cgroup v2 quota", () => {
    expect(cgroupCpuLimit(from({ "/sys/fs/cgroup/cpu.max": "2304000 100000\n" }))).toBeCloseTo(23.04);
  });

  it("treats cgroup v2 'max' as unlimited rather than falling through to v1", () => {
    expect(cgroupCpuLimit(from({ "/sys/fs/cgroup/cpu.max": "max 100000\n" }))).toBeNull();
  });

  it("reads a cgroup v1 quota when v2 is absent", () => {
    // The measured shape: v1-only host, quota/period in separate files.
    expect(
      cgroupCpuLimit(
        from({
          "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "2304000\n",
          "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
        }),
      ),
    ).toBeCloseTo(23.04);
  });

  it("treats a v1 quota of -1 as unlimited", () => {
    expect(
      cgroupCpuLimit(
        from({
          "/sys/fs/cgroup/cpu/cpu.cfs_quota_us": "-1\n",
          "/sys/fs/cgroup/cpu/cpu.cfs_period_us": "100000\n",
        }),
      ),
    ).toBeNull();
  });

  it("returns null off Linux, where none of these paths exist", () => {
    expect(cgroupCpuLimit(missing)).toBeNull();
  });
});

describe("usableCores", () => {
  it("floors to the cgroup quota instead of the affinity mask", () => {
    // The exact container that motivated this: 23.04 cores of quota, 192 reported by Node.
    expect(usableCores(from({ "/sys/fs/cgroup/cpu.max": "2304000 100000\n" }), 192)).toBe(23);
  });

  it("falls back to reported parallelism when there is no quota", () => {
    expect(usableCores(missing, 10)).toBe(10);
  });

  it("never exceeds the affinity mask, even with a generous quota", () => {
    // A quota above the visible CPUs is not extra capacity.
    expect(usableCores(from({ "/sys/fs/cgroup/cpu.max": "6400000 100000\n" }), 8)).toBe(8);
  });

  it("never returns zero, however small the quota", () => {
    expect(usableCores(from({ "/sys/fs/cgroup/cpu.max": "5000 100000\n" }), 192)).toBe(1);
  });
});
