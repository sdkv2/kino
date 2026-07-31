// `--as json` on the discovery commands, and the property that makes those listings trustworthy:
// an id the catalogue advertises must be an id the spec actually accepts. A listing that names a
// transition the validator rejects is the same failure mode as a doc that lags the code — except
// an agent hits it at full confidence, having just run the command to find out.
//
// Both renderers read one constant per catalogue, so these tests also pin that the JSON and the
// human listing cannot disagree about what exists.
import { describe, it, expect, vi } from "vitest";
import { parseSpec, OVERLAY_TWEEN_PARAMS } from "../src/spec/schema.js";
import { elements } from "../src/commands/elements.js";
import { backgrounds, CHOICES } from "../src/commands/backgrounds.js";
import { transitions, BUILT_IN } from "../src/commands/transitions.js";

/** Run a command with `--as json` and parse whatever it wrote to stdout. */
async function json(run: (o: { as: string }) => Promise<void>): Promise<Record<string, unknown>> {
  let out = "";
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(((s: string) => {
    out += s;
    return true;
  }) as typeof process.stdout.write);
  try {
    await run({ as: "json" });
  } finally {
    spy.mockRestore();
  }
  return JSON.parse(out) as Record<string, unknown>;
}

// `transition` is set on the INCOMING beat and is video/motion-only, so the second beat is a
// motion beat — a scene beat rejects the field outright, whatever the value.
const twoBeats = (transition: string) => ({
  title: "probe",
  format: ["9:16"],
  segments: [
    { text: "one", dur: 2 },
    { kind: "motion", source: "motion/a.html", dur: 2, transition },
  ],
});

describe("--as json emits parseable, labelled payloads", () => {
  it("elements", async () => {
    const d = await json(elements);
    expect(d.kind).toBe("elements");
    expect(d.tweenChannels).toEqual(OVERLAY_TWEEN_PARAMS);
    expect((d.elements as { id: string }[]).map((e) => e.id)).toContain("caption");
  });

  it("backgrounds", async () => {
    const d = await json(backgrounds);
    expect(d.kind).toBe("backgrounds");
    expect(Object.keys(d.presets as object).length).toBeGreaterThan(0);
  });

  it("transitions", async () => {
    const d = await json(transitions);
    expect(d.kind).toBe("transitions");
    expect(d.ids).toContain("dissolve");
  });

  it("keeps the guidance, not just the names — that is the part worth reading", async () => {
    const d = await json(transitions);
    const wipe = (d.builtIn as { ids: string[]; note: string }[]).find((c) => c.ids.includes("wipe-down"));
    expect(wipe?.note).toMatch(/cross-fade mushes/);
    const bg = await json(backgrounds);
    const stock = (bg.choices as { ids: string[]; note: string }[]).find((c) => c.ids.includes("mesh"));
    expect(stock?.note).toMatch(/easy AI tell/);
  });
});

describe("the catalogues cannot advertise what the spec rejects", () => {
  it("every listed transition id validates on a beat", () => {
    for (const id of BUILT_IN.flatMap((c) => c.ids)) {
      expect(() => parseSpec(twoBeats(id)), `transition "${id}" is listed but rejected`).not.toThrow();
    }
  });

  it("every listed background id validates on a spec", () => {
    for (const id of CHOICES.flatMap((c) => c.ids)) {
      expect(
        () => parseSpec({ title: "probe", format: ["9:16"], background: id, segments: [{ text: "hi", dur: 2 }] }),
        `background "${id}" is listed but rejected`,
      ).not.toThrow();
    }
  });

  it("every advertised tween channel is accepted on a real track", () => {
    for (const channel of OVERLAY_TWEEN_PARAMS) {
      const spec = {
        title: "probe",
        format: ["9:16"],
        segments: [{ text: "hi", dur: 2, captionKeyframes: [{ at: 0, params: { [channel]: 1 } }] }],
      };
      expect(() => parseSpec(spec), `channel "${channel}" is listed but rejected`).not.toThrow();
    }
  });

  it("and an id that is NOT listed is genuinely rejected — the check has teeth", () => {
    expect(() => parseSpec(twoBeats("swipe"))).toThrow();
  });
});
