// The cost rules of `kino build`, pinned as pure data.
//
// These matter more than most flag tests: getting them wrong bills a real ElevenLabs account.
// The contract is that spend is OPT-IN — nothing here should ever report `vo: "tts"` unless the
// caller explicitly asked for it. `--real` is the free half: it reads the cache `--tts` filled, so
// it must never resolve to the mode that can buy more.
import { describe, it, expect } from "vitest";
import { resolveBuildAxes } from "../src/commands/build.js";

describe("build axes — voice is opt-in", () => {
  it("a bare build is silent, presenter-less, and full quality", () => {
    expect(resolveBuildAxes({})).toEqual({ draft: false, vo: "mock", avatar: false });
  });

  it("--tts is the only way to turn spend on", () => {
    expect(resolveBuildAxes({ tts: true })).toEqual({ draft: false, vo: "tts", avatar: true });
  });

  it("never spends without an explicit --tts, whatever else is passed", () => {
    const combos = [
      {},
      { draft: true },
      { mock: true },
      { real: true },
      { avatar: true },
      { avatar: false },
      { draft: true, avatar: true },
      { real: true, avatar: true },
    ];
    for (const opts of combos) {
      expect(resolveBuildAxes(opts).vo).not.toBe("tts");
    }
  });
});

describe("build axes — draft is about speed, not cost", () => {
  it("--draft forces silent even when --tts is passed", () => {
    expect(resolveBuildAxes({ draft: true, tts: true })).toEqual({ draft: true, vo: "mock", avatar: false });
  });

  it("--draft also outranks --real — a preview reads the estimate, not the cache", () => {
    expect(resolveBuildAxes({ draft: true, real: true })).toEqual({ draft: true, vo: "mock", avatar: false });
  });

  it("--mock is still an alias of --draft", () => {
    expect(resolveBuildAxes({ mock: true })).toEqual(resolveBuildAxes({ draft: true }));
  });

  it("a silent full render is NOT a draft — that is the whole point of the split", () => {
    expect(resolveBuildAxes({}).draft).toBe(false);
  });
});

describe("build axes — --real reuses paid voiceover without buying any", () => {
  it("--real resolves to the cache-only mode", () => {
    expect(resolveBuildAxes({ real: true })).toEqual({ draft: false, vo: "cached", avatar: false });
  });

  it("--real never brings a presenter — that would spend at the avatar provider", () => {
    expect(resolveBuildAxes({ real: true, avatar: true }).avatar).toBe(false);
  });

  it("--tts outranks --real: it is the superset that fills the cache --real reads", () => {
    expect(resolveBuildAxes({ tts: true, real: true }).vo).toBe("tts");
  });

  it("no flag at all is the mock estimate, not the cache", () => {
    expect(resolveBuildAxes({}).vo).toBe("mock");
  });
});

describe("build axes — the presenter follows the voice", () => {
  it("--tts brings a presenter by default", () => {
    expect(resolveBuildAxes({ tts: true }).avatar).toBe(true);
  });

  it("--tts --no-avatar keeps the voice and drops the presenter", () => {
    expect(resolveBuildAxes({ tts: true, avatar: false })).toEqual({ draft: false, vo: "tts", avatar: false });
  });

  it("--no-avatar alone changes nothing — there was no presenter to drop", () => {
    expect(resolveBuildAxes({ avatar: false })).toEqual(resolveBuildAxes({}));
  });

  it("a presenter never survives without speech to lip-sync to", () => {
    expect(resolveBuildAxes({ avatar: true }).avatar).toBe(false);
    expect(resolveBuildAxes({ draft: true, avatar: true }).avatar).toBe(false);
  });
});
