import { describe, it, expect } from "vitest";
import { resolveCamera, CAMERA_MOVES, CAMERA_BLUR_DEFAULT, CAMERA_HOLD_DEFAULT } from "../src/render/cameraSpec.js";
import { transitionCameraForWindow } from "../src/render/transitionSpec.js";
import { assertTransitions } from "../src/spec/validate.js";
import type { KinoProps } from "../src/render/props.js";
import type { Spec } from "../src/spec/schema.js";
import { join } from "node:path";

describe("resolveCamera", () => {
  it("is undefined when unset, so existing specs upload a still camera", () => {
    expect(resolveCamera(undefined)).toBeUndefined();
  });

  it("is undefined when a move resolves to no motion — nothing to upload", () => {
    expect(resolveCamera({ zoom: 0, panX: 0, panY: 0 })).toBeUndefined();
  });

  // The property that makes a cut read as ONE shot: both sides carry the same zoom sign, so the
  // camera never reverses at the boundary. A push that became a pull halfway is the artefact.
  it("keeps zoom the same sign on both sides — the camera never reverses at the cut", () => {
    const c = resolveCamera({ move: "push" })!;
    expect(c.from.zoom).toBeGreaterThan(0);
    expect(c.to.zoom).toBe(c.from.zoom);
  });

  it("mirrors pan between the sides, so the incoming beat arrives from the opposite edge", () => {
    const c = resolveCamera({ move: "pan-left" })!;
    expect(c.to.panX).toBeCloseTo(-c.from.panX, 6);
  });

  it("pull is the negative of push", () => {
    expect(resolveCamera({ move: "pull" })!.from.zoom).toBeLessThan(0);
  });

  it("amount scales the whole move without changing its shape", () => {
    const one = resolveCamera({ move: "push" })!;
    const half = resolveCamera({ move: "push", amount: 0.5 })!;
    expect(half.from.zoom).toBeCloseTo(one.from.zoom / 2, 6);
  });

  it("explicit axes override the preset", () => {
    const c = resolveCamera({ move: "push", zoom: 0.5, panX: 0.1 })!;
    expect(c.from.zoom).toBeCloseTo(0.5, 6);
    expect(c.from.panX).toBeCloseTo(0.1, 6);
  });

  it("works with no preset at all — a raw vector is a valid move", () => {
    const c = resolveCamera({ panY: 0.2 })!;
    expect(c.from.panY).toBeCloseTo(0.2, 6);
    expect(c.to.panY).toBeCloseTo(-0.2, 6);
  });

  it("gives a whip more smear than an ordinary pan, since the smear IS the whip", () => {
    expect(resolveCamera({ move: "whip-left" })!.blur).toBeGreaterThan(resolveCamera({ move: "pan-left" })!.blur);
    expect(resolveCamera({ move: "pan-left" })!.blur).toBeCloseTo(CAMERA_BLUR_DEFAULT, 6);
  });

  it("takes an explicit blur, including zero", () => {
    expect(resolveCamera({ move: "whip-left", blur: 0 })!.blur).toBe(0);
  });

  it("refuses to guess at an unknown move rather than silently moving the wrong way", () => {
    expect(resolveCamera({ move: "nope" })).toBeUndefined();
  });

  // Without a hold the move only reaches full extent exactly at the boundary and immediately starts
  // back, so it reads as a drift. The plateau is what turns it into a punch that SITS there.
  it("holds at full extent by default rather than only peaking at the boundary", () => {
    expect(resolveCamera({ move: "push" })!.hold).toBeCloseTo(CAMERA_HOLD_DEFAULT, 6);
    expect(CAMERA_HOLD_DEFAULT).toBeGreaterThan(0);
  });

  it("takes an explicit hold, including 0 for the old continuous drift", () => {
    expect(resolveCamera({ move: "push", hold: 0 })!.hold).toBe(0);
    expect(resolveCamera({ move: "push", hold: 0.8 })!.hold).toBeCloseTo(0.8, 6);
  });

  it("clamps hold below 1 — a full hold would leave no ramp to arrive on", () => {
    expect(resolveCamera({ move: "push", hold: 5 })!.hold).toBeLessThanOrEqual(0.95);
    expect(resolveCamera({ move: "push", hold: -2 })!.hold).toBe(0);
  });

  it("every documented preset actually moves", () => {
    for (const name of Object.keys(CAMERA_MOVES)) expect(resolveCamera({ move: name })).toBeDefined();
  });
});

describe("transitionCameraForWindow", () => {
  const props = (seg1: Record<string, unknown>) =>
    ({
      fps: 30,
      theme: { mint: "#80e2b4" },
      segments: [{ kind: "motion", startSec: 0, endSec: 3, motion: {} }, { kind: "motion", startSec: 3, endSec: 6, motion: {}, ...seg1 }],
    }) as unknown as KinoProps;
  const win = { from: "beat0", to: "beat1", p: 0.5 };

  it("is undefined when the beat asks for no camera", () => {
    expect(transitionCameraForWindow(props({ transition: "wipe-down" }), win)).toBeUndefined();
  });

  it("reads off the incoming beat", () => {
    expect(transitionCameraForWindow(props({ transition: "wipe-down", transitionCamera: { move: "push" } }), win)!.from.zoom)
      .toBeGreaterThan(0);
  });

  it("composes with a custom shader — the camera lives in the sampling helpers, not the shader", () => {
    const p = props({ transition: "custom", transitionSource: "x", transitionCamera: { move: "whip-left" } });
    expect(transitionCameraForWindow(p, win)).toBeDefined();
  });

  it("composes with invert too — they are independent flags", () => {
    const p = props({ transition: "wipe-down", transitionInvert: true, transitionCamera: { move: "pull" } });
    expect(transitionCameraForWindow(p, win)!.from.zoom).toBeLessThan(0);
  });
});

describe("assertTransitions — camera", () => {
  const project = { assetPath: (r: string) => join("/nope", r), workspaceRoot: "/nope" };
  const spec = (seg: Record<string, unknown>) => ({ segments: [{ kind: "motion", source: "x.html", dur: 2, ...seg }] }) as unknown as Spec;

  it("accepts every documented move", () => {
    for (const move of Object.keys(CAMERA_MOVES)) {
      expect(() => assertTransitions(spec({ transition: "fade", transitionCamera: { move } }), project)).not.toThrow();
    }
  });

  it("rejects a misspelled move instead of silently rendering a still camera", () => {
    expect(() => assertTransitions(spec({ transition: "fade", transitionCamera: { move: "push-in" } }), project)).toThrow(
      /"push-in" is not a known move/,
    );
  });

  // The check must sit ahead of the custom-transition early return, or a typo on the most
  // configurable kind of beat would be the one place it slipped through.
  it("catches a bad move on a custom transition too", () => {
    expect(() =>
      assertTransitions(spec({ transition: "custom", transitionSource: "iris", transitionCamera: { move: "zoomy" } }), project),
    ).toThrow(/not a known move/);
  });

  it("allows a raw vector with no move name", () => {
    expect(() => assertTransitions(spec({ transition: "fade", transitionCamera: { zoom: 0.2 } }), project)).not.toThrow();
  });
});
