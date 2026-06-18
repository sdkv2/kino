import { describe, it, expect } from "vitest";
import { SpecSchema } from "../src/spec/schema.js";
import { parseLottie } from "../src/render/lottie.js";
import { lintLottie } from "../src/render/lottie.js";
import { warnLottie, lottiePlaybackRate } from "../src/render/lottie.js";

describe("SpecSchema loop field", () => {
  it("accepts loop:true on a motionOverlay", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [
        { kind: "app", asset: "screens/x.png", text: "look", caption: "c",
          motionOverlay: { source: "motion/sparkle.json", loop: true } },
      ],
    });
    expect((spec.segments[0] as any).motionOverlay.loop).toBe(true);
  });

  it("accepts loop on a kind:motion segment and defaults it to undefined when omitted", () => {
    const spec = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi", loop: false }],
    });
    expect((spec.segments[0] as any).loop).toBe(false);
    const spec2 = SpecSchema.parse({
      title: "t",
      segments: [{ kind: "motion", source: "motion/confetti.json", text: "hi" }],
    });
    expect((spec2.segments[0] as any).loop).toBeUndefined();
  });

  it("rejects a non-boolean loop", () => {
    expect(() =>
      SpecSchema.parse({ title: "t", segments: [{ kind: "motion", source: "m/x.json", text: "h", loop: 1 }] }),
    ).toThrow();
  });
});

const minimalLottie = () => ({
  v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [],
});

describe("parseLottie", () => {
  it("parses a minimal valid Lottie", () => {
    const { data } = parseLottie(JSON.stringify(minimalLottie()));
    expect(data.w).toBe(1080);
    expect(data.layers).toEqual([]);
  });
  it("throws on malformed JSON", () => {
    expect(() => parseLottie("{not json")).toThrow(/not valid JSON/i);
  });
  it("throws when core Bodymovin fields are missing", () => {
    const bad = JSON.stringify({ v: "5", w: 10, h: 10 }); // no fr/ip/op/layers
    expect(() => parseLottie(bad)).toThrow(/not a Lottie animation/i);
  });
  it("throws when duration is indeterminable (op <= ip or fr <= 0)", () => {
    const noDur = JSON.stringify({ ...minimalLottie(), op: 0, ip: 0 });
    expect(() => parseLottie(noDur)).toThrow(/determinable duration/i);
    const noFr = JSON.stringify({ ...minimalLottie(), fr: 0 });
    expect(() => parseLottie(noFr)).toThrow(/determinable duration/i);
  });
  it("throws when the top level is not a JSON object", () => {
    expect(() => parseLottie("[1,2,3]")).toThrow(/Lottie/i);
  });
});

const base = () => ({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [] as any[] });

describe("lintLottie", () => {
  it("passes a clean expression-free animation", () => {
    expect(lintLottie(base())).toEqual([]);
  });

  it("allows split-dimension positions (x as an OBJECT, not an expression)", () => {
    const d: any = base();
    d.layers = [{ ty: 4, ks: { p: { s: true, x: { a: 0, k: 540, ix: 3 }, y: { a: 0, k: 960, ix: 4 } } } }];
    expect(lintLottie(d)).toEqual([]);
  });

  it("rejects an AE expression (x is a STRING) anywhere, incl. nested precomp + effect value", () => {
    const expr: any = base();
    expr.layers = [{ ty: 4, ks: { o: { a: 0, k: 100, x: "$bm_rt = time*100;" } } }];
    expect(lintLottie(expr).some((m) => /expression/i.test(m))).toBe(true);

    const nested: any = base();
    nested.assets = [{ id: "comp_0", layers: [{ ty: 4, ks: { o: { a: 0, k: 50, x: "$bm_rt=1" } } }] }];
    expect(lintLottie(nested).some((m) => /expression/i.test(m))).toBe(true);

    const effect: any = base();
    effect.layers = [{ ty: 4, ef: [{ ef: [{ v: { a: 0, k: 1, x: "$bm_rt=0" } }] }] }];
    expect(lintLottie(effect).some((m) => /expression/i.test(m))).toBe(true);
  });

  it("rejects external/system fonts but allows an embedded (data:) font", () => {
    const sys: any = base();
    sys.fonts = { list: [{ fName: "Arial", fFamily: "Arial", fStyle: "Regular", origin: 0 }] };
    expect(lintLottie(sys).some((m) => /font/i.test(m))).toBe(true);

    const embedded: any = base();
    embedded.fonts = { list: [{ fName: "Inter", fPath: "data:font/ttf;base64,AA==" }] };
    expect(lintLottie(embedded).some((m) => /font/i.test(m))).toBe(false);
  });

  it("rejects external image assets and allows an embedded base64 image", () => {
    const ext: any = base();
    ext.assets = [{ id: "img_0", w: 10, h: 10, e: 0, u: "images/", p: "cat.png" }];
    expect(lintLottie(ext).some((m) => /external asset/i.test(m))).toBe(true);

    const emb: any = base();
    emb.assets = [{ id: "img_0", w: 10, h: 10, e: 1, u: "", p: "data:image/png;base64,AA==" }];
    expect(lintLottie(emb).some((m) => /external asset/i.test(m))).toBe(false);
  });

  it("rejects an embedded SVG image payload", () => {
    const svg: any = base();
    svg.assets = [{ id: "img_0", w: 10, h: 10, e: 1, u: "", p: "data:image/svg+xml;base64,AA==" }];
    expect(lintLottie(svg).some((m) => /svg/i.test(m))).toBe(true);
  });

  it("rejects data-driven slots", () => {
    const slots: any = base();
    slots.slots = { someKey: { p: 1 } };
    expect(lintLottie(slots).some((m) => /slot/i.test(m))).toBe(true);

    const sid: any = base();
    sid.layers = [{ ty: 4, ks: { o: { a: 0, k: 100, sid: "opacity_slot" } } }];
    expect(lintLottie(sid).some((m) => /slot/i.test(m))).toBe(true);
  });

  it("rejects an oversized document", () => {
    const big: any = base();
    big.layers = [{ ty: 4, nm: "x".repeat(3 * 1024 * 1024) }];
    expect(lintLottie(big).some((m) => /too large/i.test(m))).toBe(true);
  });

  it("emits each violation at most once", () => {
    const two: any = base();
    two.assets = [
      { id: "a", e: 0, u: "i/", p: "a.png" },
      { id: "b", e: 0, u: "i/", p: "b.png" },
    ];
    expect(lintLottie(two).filter((m) => /external asset/i.test(m))).toHaveLength(1);
  });
});

describe("warnLottie", () => {
  it("warns about a full-frame opaque solid (overlay occlusion)", () => {
    const d: any = { v: "5", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
      layers: [{ ty: 1, sc: "#000000", sw: 1080, sh: 1920, ks: { o: { a: 0, k: 100 } } }] };
    expect(warnLottie(d).some((m) => /opaque background/i.test(m))).toBe(true);
  });
  it("does not warn when there is no full-frame opaque solid", () => {
    const d: any = { v: "5", fr: 30, ip: 0, op: 60, w: 1080, h: 1920,
      layers: [{ ty: 4, shapes: [] }] };
    expect(warnLottie(d)).toEqual([]);
  });
});

describe("lottiePlaybackRate", () => {
  // Direction: docs say "higher = faster"; to play once across a LONGER beat, slow down (rate < 1).
  it("stretches a 2s asset across a 3s beat (90 frames @30fps) → 2/3", () => {
    expect(lottiePlaybackRate(2, 90, 30, false)).toBeCloseTo(2 / 3, 5);
  });
  it("normalizes fps via seconds, not raw frames (2s asset, 2s beat → 1)", () => {
    expect(lottiePlaybackRate(2, 60, 30, false)).toBeCloseTo(1, 5);
  });
  it("speeds up when the beat is shorter than the asset (2s asset, 1s beat → 2)", () => {
    expect(lottiePlaybackRate(2, 30, 30, false)).toBeCloseTo(2, 5);
  });
  it("returns 1 when looping", () => {
    expect(lottiePlaybackRate(2, 90, 30, true)).toBe(1);
  });
  it("returns 1 for degenerate inputs (no stretch possible)", () => {
    expect(lottiePlaybackRate(2, 0, 30, false)).toBe(1);
    expect(lottiePlaybackRate(0, 90, 30, false)).toBe(1);
  });
});

import { resolveMotionGraphic } from "../src/render/motiongraphic.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function projWith(file: string, contents: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-lot-"));
  const abs = join(root, file);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents);
  return { assetPath: (rel: string) => join(root, rel) };
}

describe("resolveMotionGraphic — Lottie (.json) dispatch", () => {
  const okLottie = JSON.stringify({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [] });

  it("routes a .json source to a lottie prop with empty html and forwards loop", () => {
    const project = projWith("motion/anim.json", okLottie);
    const props = resolveMotionGraphic({ source: "motion/anim.json", loop: true }, project);
    expect(props.html).toBe("");
    expect(props.proc).toBeUndefined();
    expect(props.lottie).toMatchObject({ w: 1080 });
    expect(props.loop).toBe(true);
  });

  it("dispatches case-insensitively (.JSON)", () => {
    const project = projWith("motion/anim.JSON", okLottie);
    const props = resolveMotionGraphic({ source: "motion/anim.JSON" }, project);
    expect(props.lottie).toBeDefined();
  });

  it("throws listing the lint violation for a Lottie with an expression", () => {
    const bad = JSON.stringify({ v: "5", fr: 30, ip: 0, op: 60, w: 10, h: 10,
      layers: [{ ty: 4, ks: { o: { a: 0, k: 1, x: "$bm_rt=1" } } }] });
    const project = projWith("motion/bad.json", bad);
    expect(() => resolveMotionGraphic({ source: "motion/bad.json" }, project)).toThrow(/expression/i);
  });

  it("throws a friendly parse error for non-Lottie JSON", () => {
    const project = projWith("motion/x.json", JSON.stringify({ hello: "world" }));
    expect(() => resolveMotionGraphic({ source: "motion/x.json" }, project)).toThrow(/not a Lottie animation/i);
  });

  it("rejects an unknown extension instead of silently treating it as HTML", () => {
    const project = projWith("motion/x.png", "not markup");
    expect(() => resolveMotionGraphic({ source: "motion/x.png" }, project)).toThrow(/must be \.html, \.js, or \.json/i);
  });
});
