import { describe, it, expect, vi } from "vitest";
import { complianceScan, resolveVoiceLook, resolveProvider, resolveVoice, assertCaptionModes } from "../src/spec/validate.js";
import type { Brand } from "../src/config/brand.js";
import type { Spec } from "../src/spec/schema.js";

const brand = {
  bannedPhrases: ["get the job", "guaranteed interview"],
  defaultVoice: "will",
  voiceAliases: { will: "voice123" },
  lookAliases: { lucas: "look456" },
  defaultLook: "lucas",
} as unknown as Brand;

describe("complianceScan", () => {
  it("flags a banned phrase in any text or caption", () => {
    const spec = { segments: [{ kind: "avatar", text: "You'll get the job fast", caption: "x", cta: false }] } as unknown as Spec;
    const hits = complianceScan(spec, brand);
    expect(hits).toEqual([{ phrase: "get the job", where: "segment[0].text" }]);
  });
  it("passes clean copy", () => {
    const spec = { segments: [{ kind: "avatar", text: "Tailored to the role.", caption: "honest", cta: false }] } as unknown as Spec;
    expect(complianceScan(spec, brand)).toEqual([]);
  });
});

describe("assertCaptionModes", () => {
  const wordsBrand = { ...brand, captionMode: "words" } as unknown as Brand;
  const warns = (spec: Spec, b: Brand) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    assertCaptionModes(spec, b);
    const out = spy.mock.calls.flat().join("\n");
    spy.mockRestore();
    return out;
  };
  it("warns when a words-mode beat carries a caption that will never paint", () => {
    const spec = {
      segments: [{ kind: "app", asset: "a.png", text: "The full spoken line paints instead.", caption: "short hook" }],
    } as unknown as Spec;
    expect(warns(spec, wordsBrand)).toMatch(/caption is ignored under words mode/);
  });
  it("stays quiet for phrase beats, caption-free beats, and caption === text", () => {
    const spec = {
      segments: [
        { kind: "app", asset: "a.png", text: "Spoken.", caption: "Different hook", captionMode: "phrase" },
        { kind: "avatar", text: "No caption here.", cta: false },
        { kind: "avatar", text: "Same words.", caption: "Same words.", cta: false },
      ],
    } as unknown as Spec;
    expect(warns(spec, wordsBrand)).toBe("");
  });
  it("resolves brand < spec < segment (spec-level words triggers the warn too)", () => {
    const spec = {
      captionMode: "words",
      segments: [{ kind: "app", asset: "a.png", text: "Spoken line.", caption: "hook" }],
    } as unknown as Spec;
    expect(warns(spec, brand)).toMatch(/caption is ignored/);
  });
});

describe("resolveVoiceLook", () => {
  it("resolves aliases to ids, honouring spec overrides then brand defaults", () => {
    const r = resolveVoiceLook({ voice: "will" } as Spec, brand);
    expect(r).toEqual({ voiceId: "voice123", lookId: "look456" });
  });
});

describe("resolveVoice", () => {
  it("resolves the voice alias without requiring an avatar look (faceless needs no look)", () => {
    expect(resolveVoice({} as unknown as Spec, brand)).toBe("voice123");
  });
  it("honours a spec voice override", () => {
    const b = { defaultVoice: "x", voiceAliases: { will: "voice123", x: "other" } } as unknown as Brand;
    expect(resolveVoice({ voice: "will" } as unknown as Spec, b)).toBe("voice123");
  });
});

describe("resolveProvider", () => {
  it("defaults to faceless (none) when neither spec nor brand sets one", () => {
    expect(resolveProvider({} as unknown as Spec, {} as unknown as Brand)).toBe("none");
  });
  it("falls back to the brand default when the spec is silent", () => {
    expect(resolveProvider({} as unknown as Spec, { defaultProvider: "none" } as unknown as Brand)).toBe("none");
  });
  it("lets the spec override the brand default", () => {
    expect(
      resolveProvider({ provider: "hedra" } as unknown as Spec, { defaultProvider: "none" } as unknown as Brand),
    ).toBe("hedra");
  });
});
