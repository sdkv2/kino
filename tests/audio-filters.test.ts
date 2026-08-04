// Pure string assertions on the ffmpeg graph the audio mix builds. The important one is the
// FIRST test: at their defaults the chains have to be byte-identical to what kino emitted before
// pan/rate/voVolume existed, or every already-shipped spec renders different audio.
// The graph is also exercised against real ffmpeg in tests/audio-mix.test.ts.
import { describe, it, expect } from "vitest";
import { panGains, sfxFilterChain, voFilterChain, UNIFORM } from "../src/render/native/audioFilters.js";

describe("sfxFilterChain", () => {
  it("emits the pre-pan/rate string byte-for-byte at the defaults", () => {
    // Frozen literal, deliberately not built from UNIFORM: this is the contract with every spec
    // authored before these knobs existed. If a change makes this fail, the change is wrong.
    const legacy = "[3:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,adelay=450|450,volume=0.22[sfx1]";
    expect(sfxFilterChain({ at: 0.45, volume: 0.22 }, 3, "sfx1")).toBe(legacy);
    // Explicit defaults are the same as absent — a centre pan is not normalized into a unity gain.
    expect(sfxFilterChain({ at: 0.45, volume: 0.22, pan: 0, rate: 1 }, 3, "sfx1")).toBe(legacy);
  });

  it("rounds `at` to whole milliseconds for adelay, in both channels", () => {
    expect(sfxFilterChain({ at: 7.9004, volume: 1 }, 0, "sfx0")).toContain("adelay=7900|7900");
    expect(sfxFilterChain({ at: 0, volume: 1 }, 0, "sfx0")).toContain("adelay=0|0");
  });

  it("puts the varispeed pair BEFORE adelay, so the event still lands at `at`", () => {
    const chain = sfxFilterChain({ at: 2, volume: 1, rate: 1.5 }, 0, "sfx0");
    expect(chain).toBe(`[0:a]${UNIFORM},asetrate=66150,aresample=44100,adelay=2000|2000,volume=1[sfx0]`);
    // asetrate reinterprets the stream's clock; anything already delayed would be retimed with it.
    expect(chain.indexOf("asetrate")).toBeLessThan(chain.indexOf("adelay"));
    expect(chain.indexOf("aresample")).toBeLessThan(chain.indexOf("adelay"));
  });

  it("resolves the rate to an integer sample rate rather than an ffmpeg expression", () => {
    expect(sfxFilterChain({ at: 0, volume: 1, rate: 0.5 }, 0, "s")).toContain("asetrate=22050,aresample=44100");
    expect(sfxFilterChain({ at: 0, volume: 1, rate: 1.0594 }, 0, "s")).toContain("asetrate=46720,aresample=44100");
  });

  it("appends a constant-power pan that scales the source's own channels", () => {
    expect(sfxFilterChain({ at: 1, volume: 0.5, pan: -1 }, 2, "sfx2")).toBe(
      `[2:a]${UNIFORM},adelay=1000|1000,volume=0.5,pan=stereo|c0=1.414214*c0|c1=0*c1[sfx2]`,
    );
    expect(sfxFilterChain({ at: 1, volume: 0.5, pan: 1 }, 2, "sfx2")).toContain("pan=stereo|c0=0*c0|c1=1.414214*c1");
  });

  it("combines rate and pan in one chain, rate first", () => {
    const chain = sfxFilterChain({ at: 0.5, volume: 1, pan: 0.5, rate: 2 }, 1, "sfx1");
    expect(chain).toBe(
      `[1:a]${UNIFORM},asetrate=88200,aresample=44100,adelay=500|500,volume=1,pan=stereo|c0=0.541196*c0|c1=1.306563*c1[sfx1]`,
    );
  });
});

describe("sfx fades", () => {
  it("emits nothing for absent fades — byte-identical to the unfaded chain", () => {
    expect(sfxFilterChain({ at: 1, volume: 1, fadeInSec: 0, fadeOutSec: 0 }, 0, "s")).toBe(
      sfxFilterChain({ at: 1, volume: 1 }, 0, "s"),
    );
  });

  it("fades in from the event's own start, before adelay", () => {
    const chain = sfxFilterChain({ at: 2, volume: 1, fadeInSec: 0.05 }, 0, "s");
    expect(chain).toBe(`[0:a]${UNIFORM},afade=t=in:st=0:d=0.05,adelay=2000|2000,volume=1[s]`);
    // The fade must land before the event is placed, or it would fade the timeline around `at`.
    expect(chain.indexOf("afade")).toBeLessThan(chain.indexOf("adelay"));
  });

  it("fades out the LAST fadeOutSec via reverse-fade-reverse", () => {
    const chain = sfxFilterChain({ at: 1, volume: 1, fadeOutSec: 0.15 }, 0, "s");
    expect(chain).toBe(`[0:a]${UNIFORM},areverse,afade=t=in:st=0:d=0.15,areverse,adelay=1000|1000,volume=1[s]`);
  });

  it("combines fade-in and fade-out, both before adelay", () => {
    const chain = sfxFilterChain({ at: 3, volume: 0.5, fadeInSec: 0.02, fadeOutSec: 0.1 }, 1, "s");
    const adelay = chain.indexOf("adelay");
    expect(chain.indexOf("afade=t=in:st=0:d=0.02")).toBeLessThan(adelay);
    expect(chain.indexOf("areverse")).toBeLessThan(adelay);
    expect(chain.indexOf("areverse,afade=t=in:st=0:d=0.1,areverse")).toBeLessThan(adelay);
  });

  it("rides after the varispeed pair, so fades scale with rate", () => {
    const chain = sfxFilterChain({ at: 1, volume: 1, rate: 2, fadeInSec: 0.05 }, 0, "s");
    // asetrate first (retimes the clock), THEN the fade — so fade seconds are played seconds.
    expect(chain.indexOf("asetrate")).toBeLessThan(chain.indexOf("afade"));
    expect(chain).toContain("asetrate=88200,aresample=44100,afade=t=in:st=0:d=0.05,adelay=1000|1000");
  });
});

describe("panGains", () => {
  it("is unity at centre, so pan 0 really is 'no pan'", () => {
    const c = panGains(0);
    expect(c.left).toBeCloseTo(1, 12);
    expect(c.right).toBeCloseTo(1, 12);
  });

  it("holds power constant across the field", () => {
    for (const p of [-1, -0.75, -0.3, 0, 0.2, 0.6, 1]) {
      const { left, right } = panGains(p);
      expect(left * left + right * right).toBeCloseTo(2, 10);
    }
  });

  it("is continuous through centre — no step where the filter starts being emitted", () => {
    expect(panGains(-1e-6).left).toBeCloseTo(1, 5);
    expect(panGains(1e-6).right).toBeCloseTo(1, 5);
  });

  it("silences the opposite channel at a hard pan and is monotonic between", () => {
    expect(panGains(-1).right).toBeCloseTo(0, 12);
    expect(panGains(1).left).toBeCloseTo(0, 12);
    let prev = -Infinity;
    for (let p = -1; p <= 1.0001; p += 0.1) {
      const r = panGains(p).right;
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });
});

describe("voFilterChain", () => {
  it("emits the pre-voVolume string byte-for-byte at the default", () => {
    const legacy = "[0:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[vo]";
    expect(voFilterChain(0, "vo")).toBe(legacy);
    expect(voFilterChain(0, "vo", 1)).toBe(legacy);
  });

  it("appends a gain when the spec asks for one", () => {
    expect(voFilterChain(0, "vo", 0.7)).toBe(`[0:a]${UNIFORM},volume=0.7[vo]`);
    expect(voFilterChain(2, "vo", 0)).toBe(`[2:a]${UNIFORM},volume=0[vo]`);
  });
});
