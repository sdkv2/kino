import { describe, it, expect } from "vitest";
import { complianceScan, resolveVoiceLook } from "../src/spec/validate.js";
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

describe("resolveVoiceLook", () => {
  it("resolves aliases to ids, honouring spec overrides then brand defaults", () => {
    const r = resolveVoiceLook({ voice: "will" } as Spec, brand);
    expect(r).toEqual({ voiceId: "voice123", lookId: "look456" });
  });
});
