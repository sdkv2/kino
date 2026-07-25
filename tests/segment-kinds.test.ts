import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";
import { parsePresenterSource, presenterBeats, resolvePresenterPin } from "../src/avatar/source.js";

const spec = (segments: unknown[]) => SpecSchema.parse({ title: "kinds", segments });

describe("segment kinds", () => {
  it("defaults an unlabelled beat to a scene", () => {
    const s = spec([{ text: "no kind here" }]);
    expect(s.segments[0].kind).toBe("scene");
    expect(s.segments[0].kind === "scene" && s.segments[0].source).toBeUndefined();
  });

  it("takes a presenter on a scene via the avatar: scheme", () => {
    const s = spec([{ kind: "scene", source: "avatar:", text: "on camera" }]);
    expect(presenterBeats(s)).toEqual([true]);
  });

  it("collapses a video beat pointing at a presenter into a scene", () => {
    // Authors write one kind: "video" for everything; a generated presenter is a scene internally.
    const s = spec([{ kind: "video", source: "heygen:look-42", text: "hi" }]);
    expect(s.segments[0].kind).toBe("scene");
    expect(presenterBeats(s)).toEqual([true]);
  });

  it("keeps an asset-backed video beat as a video", () => {
    const s = spec([{ kind: "video", source: "screens/05.png", text: "hi" }]);
    expect(s.segments[0].kind).toBe("video");
    expect(presenterBeats(s)).toEqual([false]);
  });

  it("rejects footage on a scene — that is what a video beat is for", () => {
    expect(() => spec([{ kind: "scene", source: "screens/05.png", text: "hi" }])).toThrow(
      /scene source must be a presenter/,
    );
  });
});

describe("legacy kinds (pre-1.22 specs)", () => {
  it("reads kind avatar as a scene that still seeks the configured provider", () => {
    const s = spec([{ kind: "avatar", text: "I ran my CV through five AI tools." }]);
    expect(s.segments[0].kind).toBe("scene");
    expect(presenterBeats(s)).toEqual([true]);
    // No provider pinned: the build falls back to spec/brand/project config, as it always did.
    expect(resolvePresenterPin(s)).toEqual({ provider: null, look: null });
  });

  it("reads kind app with an asset as a video beat with a source", () => {
    const s = spec([{ kind: "app", asset: "recordings/scroll.mp4", text: "hi", clipFrom: 2 }]);
    const seg = s.segments[0];
    expect(seg.kind).toBe("video");
    expect(seg.kind === "video" && seg.source).toBe("recordings/scroll.mp4");
    expect(seg.kind === "video" && seg.clipFrom).toBe(2);
  });
});

describe("presenter sources", () => {
  it("splits a pinned provider from its look", () => {
    expect(parsePresenterSource("heygen:look-42")).toEqual({ provider: "heygen", look: "look-42" });
    expect(parsePresenterSource("hedra:portraits/founder.png")).toEqual({
      provider: "hedra",
      look: "portraits/founder.png",
    });
    expect(parsePresenterSource("avatar:")).toEqual({ provider: null, look: null });
  });

  it("resolves one pin across several agreeing beats", () => {
    const s = spec([
      { kind: "scene", source: "heygen:look-42", text: "one" },
      { kind: "scene", source: "avatar:", text: "two" },
      { kind: "scene", source: "heygen:look-42", text: "three" },
    ]);
    expect(resolvePresenterPin(s)).toEqual({ provider: "heygen", look: "look-42" });
  });

  it("refuses beats that pin different providers — one clip is generated per build", () => {
    const s = spec([
      { kind: "scene", source: "heygen:", text: "one" },
      { kind: "scene", source: "hedra:", text: "two" },
    ]);
    expect(() => resolvePresenterPin(s)).toThrow(/different presenter providers/);
  });

  it("refuses beats that pin different looks", () => {
    const s = spec([
      { kind: "scene", source: "heygen:look-1", text: "one" },
      { kind: "scene", source: "heygen:look-2", text: "two" },
    ]);
    expect(() => resolvePresenterPin(s)).toThrow(/different presenter looks/);
  });

  it("reports no pin when nothing is on camera", () => {
    expect(resolvePresenterPin(spec([{ text: "voice over a background" }]))).toBeNull();
  });
});
