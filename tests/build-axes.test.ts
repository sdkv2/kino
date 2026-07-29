// The cost rules of `kino build`, pinned as pure data.
//
// These matter more than most flag tests: getting them wrong bills a real ElevenLabs account.
// The contract is that spend is OPT-IN — nothing here should ever report `tts: true` unless the
// caller explicitly asked for it.
import { describe, it, expect } from "vitest";
import { resolveBuildAxes } from "../src/commands/build.js";

describe("build axes — voice is opt-in", () => {
  it("a bare build is silent, presenter-less, and full quality", () => {
    expect(resolveBuildAxes({})).toEqual({ draft: false, tts: false, avatar: false });
  });

  it("--tts is the only way to turn spend on", () => {
    expect(resolveBuildAxes({ tts: true })).toEqual({ draft: false, tts: true, avatar: true });
  });

  it("never spends without an explicit --tts, whatever else is passed", () => {
    for (const opts of [{}, { draft: true }, { mock: true }, { avatar: true }, { avatar: false }, { draft: true, avatar: true }]) {
      expect(resolveBuildAxes(opts).tts).toBe(false);
    }
  });
});

describe("build axes — draft is about speed, not cost", () => {
  it("--draft forces silent even when --tts is passed", () => {
    expect(resolveBuildAxes({ draft: true, tts: true })).toEqual({ draft: true, tts: false, avatar: false });
  });

  it("--mock is still an alias of --draft", () => {
    expect(resolveBuildAxes({ mock: true })).toEqual(resolveBuildAxes({ draft: true }));
  });

  it("a silent full render is NOT a draft — that is the whole point of the split", () => {
    expect(resolveBuildAxes({}).draft).toBe(false);
  });
});

describe("build axes — the presenter follows the voice", () => {
  it("--tts brings a presenter by default", () => {
    expect(resolveBuildAxes({ tts: true }).avatar).toBe(true);
  });

  it("--tts --no-avatar keeps the voice and drops the presenter", () => {
    expect(resolveBuildAxes({ tts: true, avatar: false })).toEqual({ draft: false, tts: true, avatar: false });
  });

  it("--no-avatar alone changes nothing — there was no presenter to drop", () => {
    expect(resolveBuildAxes({ avatar: false })).toEqual(resolveBuildAxes({}));
  });

  it("a presenter never survives without speech to lip-sync to", () => {
    expect(resolveBuildAxes({ avatar: true }).avatar).toBe(false);
    expect(resolveBuildAxes({ draft: true, avatar: true }).avatar).toBe(false);
  });
});
