import { describe, it, expect } from "vitest";
import {
  parseMorphStops,
  morphStopsD,
  applyPathMorphs,
  lintPathMorphs,
  hasPathMorph,
  MORPH_STOPS,
} from "../src/render/pathMorph.js";

const A = "M0,0 L10,0 Z"; // three shapes, identical command structure
const B = "M0,0 L20,0 Z";
const C = "M0,0 L40,0 Z";
const SEQ = `0: ${A} | 0.5: ${B} | 1: ${C}`;

/** The x of the L command, which is the only thing moving in these fixtures. formatPathD emits
 *  space-separated args ("L15 0"), and the authored data-kino-morph-* attributes survive in the
 *  output, so this must read the RESOLVED d attribute rather than scanning the whole tag. */
const lx = (s: string): number => {
  const d = /(?:^|\s)d="([^"]*)"/.exec(s)?.[1] ?? s;
  return Number(/L\s*([-\d.]+)/.exec(d)![1]);
};

describe("parseMorphStops", () => {
  it("parses positions and path data", () => {
    expect(parseMorphStops(SEQ)).toEqual([
      { at: 0, d: A },
      { at: 0.5, d: B },
      { at: 1, d: C },
    ]);
  });

  it("sorts stops so they may be authored in any order", () => {
    expect(parseMorphStops(`1: ${C} | 0: ${A} | 0.5: ${B}`).map((s) => s.at)).toEqual([0, 0.5, 1]);
  });

  it("requires at least two stops", () => {
    expect(() => parseMorphStops(`0: ${A}`)).toThrow(/at least 2 stops/);
  });

  it("rejects a stop with no colon, no data, or a non-numeric position", () => {
    expect(() => parseMorphStops(`0: ${A} | ${B}`)).toThrow(/has no ":"/);
    expect(() => parseMorphStops(`0: ${A} | 0.5:`)).toThrow(/no path data/);
    expect(() => parseMorphStops(`0: ${A} | half: ${B}`)).toThrow(/non-numeric position/);
  });

  it("rejects positions outside 0..1 and duplicate positions", () => {
    expect(() => parseMorphStops(`0: ${A} | 1.4: ${B}`)).toThrow(/positions are 0\.\.1/);
    expect(() => parseMorphStops(`0.5: ${A} | 0.5: ${B}`)).toThrow(/share position 0\.5/);
  });
});

describe("morphStopsD", () => {
  const stops = parseMorphStops(SEQ);

  it("returns the exact endpoint shapes at 0 and 1", () => {
    expect(lx(morphStopsD(stops, 0))).toBe(10);
    expect(lx(morphStopsD(stops, 1))).toBe(40);
  });

  it("lands on an interior stop exactly", () => {
    expect(lx(morphStopsD(stops, 0.5))).toBe(20);
  });

  it("interpolates within the bracketing segment, not across the whole range", () => {
    // Quarter-way overall is half-way through the FIRST segment: 10 → 20 gives 15.
    // A single from/to across the same range would give 17.5, which is the bug this replaces.
    expect(lx(morphStopsD(stops, 0.25))).toBe(15);
    // Three-quarters is half-way through the second segment: 20 → 40 gives 30.
    expect(lx(morphStopsD(stops, 0.75))).toBe(30);
  });

  it("holds the end shapes outside the range rather than extrapolating", () => {
    expect(lx(morphStopsD(stops, -3))).toBe(10);
    expect(lx(morphStopsD(stops, 9))).toBe(40);
  });

  it("handles unevenly spaced stops", () => {
    const uneven = parseMorphStops(`0: ${A} | 0.8: ${B} | 1: ${C}`);
    expect(lx(morphStopsD(uneven, 0.4))).toBe(15); // half of the first, wide segment
    expect(lx(morphStopsD(uneven, 0.9))).toBe(30); // half of the second, narrow one
  });

  it("is monotonic across a sweep for monotonic stops — no jump at a handoff", () => {
    // The property that makes this usable in a mask: one path, no cross-fade, and no discontinuity
    // where one segment hands to the next.
    let prev = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const v = lx(morphStopsD(stops, i / 40));
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("stops in a motion page", () => {
  it("is detected by the cheap gate", () => {
    expect(hasPathMorph(`<path ${MORPH_STOPS}="${SEQ}"/>`)).toBe(true);
  });

  it("resolves d from the driver and leaves no authored d behind", () => {
    const html = `<path d="M9,9" ${MORPH_STOPS}="${SEQ}" data-kino-morph-t="var(--m)"/>`;
    const out = applyPathMorphs(html, { "--m": "0.5" });
    expect(out.errors).toEqual([]);
    expect(lx(out.html)).toBe(20);
    expect(out.html.match(/ d="/g)).toHaveLength(1);
  });

  it("works inside a <mask> — the case a cross-fade could not do", () => {
    const html = `<mask id="m"><path fill="#fff" ${MORPH_STOPS}="${SEQ}"/></mask>`;
    const out = applyPathMorphs(html, { "--progress": "0.25" });
    expect(out.errors).toEqual([]);
    expect(lx(out.html)).toBe(15);
    // One path, full opacity: nothing in the output can produce a half-luminance handoff.
    expect(out.html).not.toMatch(/opacity/);
  });

  it("reports a structural mismatch between any consecutive pair at lint time", () => {
    const bad = `0: ${A} | 0.5: M0,0 C1,1 2,2 3,3 Z | 1: ${C}`;
    const problems = lintPathMorphs(`<path ${MORPH_STOPS}="${bad}"/>`);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/cannot be interpolated/);
  });

  it("passes lint for a well-formed sequence", () => {
    expect(lintPathMorphs(`<path ${MORPH_STOPS}="${SEQ}"/>`)).toEqual([]);
  });

  it("still supports the two-endpoint form unchanged", () => {
    const html = '<path data-kino-morph-from="M0,0 L10,0 Z" data-kino-morph-to="M0,0 L20,0 Z"/>';
    const out = applyPathMorphs(html, { "--progress": "0.5" });
    expect(out.errors).toEqual([]);
    expect(lx(out.html)).toBe(15);
  });
});
