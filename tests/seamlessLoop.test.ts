import { describe, expect, it, vi } from "vitest";
import { assertSeamlessLoop } from "../src/spec/validate.js";
import type { Spec } from "../src/spec/schema.js";

function motionSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    title: "loop-ad",
    segments: [
      { kind: "motion", source: "prompt-type", text: "Make me an advert please." },
      { kind: "motion", source: "loop-ready", text: "Tell your agent now." },
    ],
    film: 0,
    seamlessLoop: true,
    ...overrides,
  } as Spec;
}

describe("assertSeamlessLoop", () => {
  it("no-ops when unset", () => {
    expect(() => assertSeamlessLoop({ title: "x", segments: [{ kind: "avatar", text: "hi" }] } as Spec)).not.toThrow();
  });

  it("requires last segment to be motion", () => {
    expect(() =>
      assertSeamlessLoop(
        motionSpec({
          segments: [
            { kind: "motion", source: "prompt-type", text: "Make me an advert." },
            { kind: "avatar", text: "Tell your agent." },
          ],
        }),
      ),
    ).toThrow(/last segment/);
  });

  it("accepts a well-formed loop", () => {
    expect(() => assertSeamlessLoop(motionSpec())).not.toThrow();
  });

  it("warns when film is unset", async () => {
    const { log } = await import("../src/log.js");
    const spy = vi.spyOn(log, "warn").mockImplementation(() => {});
    assertSeamlessLoop(motionSpec({ film: undefined }));
    expect(spy.mock.calls.some((c) => String(c[0]).includes("film"))).toBe(true);
    spy.mockRestore();
  });
});
