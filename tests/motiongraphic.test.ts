import { describe, it, expect } from "vitest";
import { lintMotionHtml, sanitizeMotionHtml, resolveMotionGraphic, lintMotionJs } from "../src/render/motiongraphic.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("lintMotionHtml", () => {
  it("passes a clean CSS-variable-driven fragment", () => {
    const html = `<style>.b{width:calc(var(--pct)*1%);color:var(--kino-mint)}</style><div class="b"></div>`;
    expect(lintMotionHtml(html)).toEqual([]);
  });
  it("allows @keyframes (now scrubbed deterministically, not banned)", () => {
    expect(lintMotionHtml(`<style>@keyframes x{from{opacity:0}to{opacity:1}}</style>`)).toEqual([]);
  });
  it("rejects CSS transition", () => {
    expect(lintMotionHtml(`<style>.b{transition: all .3s}</style>`)[0]).toMatch(/transition/i);
  });
  it("rejects <script>", () => {
    expect(lintMotionHtml(`<script>alert(1)</script>`)[0]).toMatch(/script/i);
  });
  it("rejects inline event handlers", () => {
    expect(lintMotionHtml(`<div onclick="x()"></div>`)[0]).toMatch(/event handler/i);
  });
  it("rejects timers/RAF and non-deterministic globals", () => {
    expect(lintMotionHtml(`<div>requestAnimationFrame</div>`).length).toBeGreaterThan(0);
    expect(lintMotionHtml(`<div>Math.random()</div>`).length).toBeGreaterThan(0);
  });
  it("rejects external/relative url() but allows data: and #fragment", () => {
    expect(lintMotionHtml(`<style>.b{background:url(https://x/y.png)}</style>`).length).toBe(1);
    expect(lintMotionHtml(`<style>.b{background:url(foo.png)}</style>`).length).toBe(1);
    expect(lintMotionHtml(`<style>.b{background:url(data:image/png;base64,AA==)}</style>`)).toEqual([]);
    expect(lintMotionHtml(`<style>.b{fill:url(#grad)}</style>`)).toEqual([]);
    // the injected SVG-texture filters are referenced by #fragment, so they pass the lint
    expect(lintMotionHtml(`<style>.b{filter:url(#kino-grain)}.c{filter:url(#kino-displace)}</style>`)).toEqual([]);
  });
  it("rejects each remaining non-deterministic / network construct", () => {
    for (const bad of [
      `<div>fetch(</div>`,
      `<div>XMLHttpRequest</div>`,
      `<div>setInterval</div>`,
      `<div>setTimeout</div>`,
      `<div>Date.now</div>`,
    ]) {
      expect(lintMotionHtml(bad).length).toBeGreaterThan(0);
    }
  });
  it("allows url( data:...) with leading whitespace, still rejects spaced external urls", () => {
    expect(lintMotionHtml(`<style>.b{background:url( data:image/png;base64,AA==)}</style>`)).toEqual([]);
    expect(lintMotionHtml(`<style>.b{background:url( https://x/y.png)}</style>`).length).toBe(1);
  });
  it("rejects @import", () => {
    expect(lintMotionHtml(`<style>@import "https://evil/x.css";</style>`)[0]).toMatch(/import/i);
  });
  it("rejects transition longhands (not just the shorthand)", () => {
    expect(lintMotionHtml(`<style>.b{transition-property:width;transition-duration:.3s}</style>`).length).toBeGreaterThan(0);
  });
  it("allows animation longhands except animation-play-state", () => {
    expect(lintMotionHtml(`<style>.b{animation-name:x;animation-delay:1s;animation-duration:2s}</style>`)).toEqual([]);
    expect(lintMotionHtml(`<style>.b{animation-play-state:running}</style>`)[0]).toMatch(/animation-play-state/i);
  });
  it("rejects SVG SMIL <animate>", () => {
    expect(lintMotionHtml(`<svg><rect><animate attributeName="x" dur="1s"/></rect></svg>`)[0]).toMatch(/SMIL|animate/i);
  });
});

describe("lintMotionJs", () => {
  it("passes a clean render(env) body", () => {
    expect(lintMotionJs("const n = env.params.count; return `<div>${n}</div>`;")).toEqual([]);
  });
  it("allows Math.* geometry", () => {
    expect(lintMotionJs("return Math.sin(env.t) + Math.cos(env.frame) + Math.round(env.progress)")).toEqual([]);
  });
  it("rejects Math.random / Date.now / new Date", () => {
    expect(lintMotionJs("return Math.random()")[0]).toMatch(/Math\.random/);
    expect(lintMotionJs("return Date.now()")[0]).toMatch(/Date\.now/i);
    expect(lintMotionJs("return new Date()")[0]).toMatch(/new Date/i);
  });
  it("rejects timers, network, modules, and Node/DOM globals", () => {
    expect(lintMotionJs("setTimeout(()=>{},1)").length).toBeGreaterThan(0);
    expect(lintMotionJs("fetch('/x')").length).toBeGreaterThan(0);
    expect(lintMotionJs("require('fs')").length).toBeGreaterThan(0);
    expect(lintMotionJs("const k = process.env.KEY").length).toBeGreaterThan(0);
    expect(lintMotionJs("document.body.innerHTML = ''").length).toBeGreaterThan(0);
  });
  it("rejects eval / Function constructor / atob (dynamic code execution)", () => {
    expect(lintMotionJs("return eval('1+1')")[0]).toMatch(/eval/i);
    expect(lintMotionJs("return new Function('return 1')()")[0]).toMatch(/Function/);
    expect(lintMotionJs("return Function('return 1')()")[0]).toMatch(/Function/);
    expect(lintMotionJs("return atob('YQ==')")[0]).toMatch(/eval|atob/i);
  });
  it("rejects computed access to Date/Math that bracket-notation uses to dodge Date.now/Math.random", () => {
    expect(lintMotionJs('return Date["now"]()')[0]).toMatch(/Date/i);
    expect(lintMotionJs('return Math["random"]()')[0]).toMatch(/Math/i);
  });
  it("still allows ordinary Math.* dotted geometry and user-defined functions", () => {
    expect(lintMotionJs("return Math.sin(env.t) * Math.PI")).toEqual([]);
    expect(lintMotionJs("const toBar = (v) => `<i style=height:${v}%></i>`; return toBar(env.params.v)")).toEqual([]);
  });
});

describe("sanitizeMotionHtml", () => {
  it("strips <script> and event handlers but keeps <style> + structure", () => {
    const out = sanitizeMotionHtml(`<style>.b{color:red}</style><div class="b" onclick="x()">hi</div><script>bad()</script>`);
    expect(out).toContain("<style>");
    expect(out).toContain("hi");
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onclick/i);
  });
  it("keeps @keyframes + animation-name + the kino-anim class through sanitization", () => {
    const out = sanitizeMotionHtml(`<style>@keyframes f{from{opacity:0}to{opacity:1}} .b{animation-name:f}</style><div class="b kino-anim"></div>`);
    expect(out).toContain("@keyframes");
    expect(out).toContain("animation-name");
    expect(out).toContain("kino-anim");
  });
});

describe("resolveMotionGraphic", () => {
  function projWith(file: string, contents: string) {
    const root = mkdtempSync(join(tmpdir(), "kino-mg-"));
    const abs = join(root, file);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
    return { assetPath: (rel: string) => join(root, rel) };
  }
  it("reads, sanitizes, and attaches JSON params/keyframes/triggers", () => {
    const project = projWith("motion/ok.html", `<style>.b{width:calc(var(--pct)*1%)}</style><div class="b"></div>`);
    const props = resolveMotionGraphic({ source: "motion/ok.html", params: { pct: 10 }, keyframes: [], triggers: [] }, project);
    expect(props.html).toContain("<style>");
    expect(props.params).toEqual({ pct: 10 });
  });
  it("throws a clear error for a missing file", () => {
    const project = { assetPath: (rel: string) => join("/nope", rel) };
    expect(() => resolveMotionGraphic({ source: "motion/x.html" }, project)).toThrow(/Missing motion graphic/);
  });
  it("throws listing the lint violation for a banned construct", () => {
    const project = projWith("motion/bad.html", `<style>.b{animation-play-state:running}</style>`);
    expect(() => resolveMotionGraphic({ source: "motion/bad.html" }, project)).toThrow(/animation-play-state/i);
  });
  it("routes a .js source to proc (linted, not sanitized) with empty html", () => {
    const project = projWith("motion/gen.js", "return `<div class=\"x\"></div>`;");
    const props = resolveMotionGraphic({ source: "motion/gen.js" }, project);
    expect(props.proc).toContain("<div");
    expect(props.html).toBe("");
  });
  it("throws listing the JS lint violation for a banned construct in a .js source", () => {
    const project = projWith("motion/bad.js", "return Math.random()");
    expect(() => resolveMotionGraphic({ source: "motion/bad.js" }, project)).toThrow(/Math\.random/);
  });
});

import { assertMotionGraphics } from "../src/spec/validate.js";
import type { Spec } from "../src/spec/schema.js";

describe("assertMotionGraphics", () => {
  function projWith(file: string, contents: string) {
    const root = mkdtempSync(join(tmpdir(), "kino-mgv-"));
    const abs = join(root, "assets", file);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
    return { assetPath: (rel: string) => join(root, "assets", rel) };
  }
  it("passes when every motion source exists and is clean", () => {
    const project = projWith("motion/ok.html", `<div style="width:calc(var(--progress)*100%)"></div>`);
    const spec = { segments: [{ kind: "motion", source: "motion/ok.html", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).not.toThrow();
  });
  it("throws for a missing overlay source", () => {
    const project = { assetPath: (rel: string) => join("/nope", rel) };
    const spec = { segments: [{ kind: "app", asset: "a.png", text: "x", caption: "c", motionOverlay: { source: "motion/missing.html" } }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/Missing motion graphic/);
  });
  it("throws naming the segment + violation for a banned construct", () => {
    const project = projWith("motion/bad.html", `<style>.b{transition:all .3s}</style>`);
    const spec = { segments: [{ kind: "motion", source: "motion/bad.html", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/segment\[0\].*transition/i);
  });
  it("lints a .js motion source with the JS denylist", () => {
    const project = projWith("motion/bad.js", "return fetch('/x')");
    const spec = { segments: [{ kind: "motion", source: "motion/bad.js", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/network access/i);
  });
  it("validates a clean Lottie .json motion source", () => {
    const project = projWith("motion/ok.json", JSON.stringify({ v: "5.7.4", fr: 30, ip: 0, op: 60, w: 1080, h: 1920, layers: [] }));
    const spec = { segments: [{ kind: "motion", source: "motion/ok.json", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).not.toThrow();
  });
  it("rejects a Lottie .json with an AE expression at validation time", () => {
    const bad = JSON.stringify({ v: "5", fr: 30, ip: 0, op: 60, w: 10, h: 10, layers: [{ ty: 4, ks: { o: { a: 0, k: 1, x: "$bm_rt=1" } } }] });
    const project = projWith("motion/bad.json", bad);
    const spec = { segments: [{ kind: "motion", source: "motion/bad.json", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/segment\[0\].*expression/i);
  });
  it("rejects a non-Lottie .json at validation time (not silently HTML-linted)", () => {
    const project = projWith("motion/x.json", JSON.stringify({ hello: "world" }));
    const spec = { segments: [{ kind: "motion", source: "motion/x.json", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/not a Lottie animation/i);
  });
  it("rejects an unknown motion extension at validation time", () => {
    const project = projWith("motion/x.png", "not markup");
    const spec = { segments: [{ kind: "motion", source: "motion/x.png", text: "x" }] } as unknown as Spec;
    expect(() => assertMotionGraphics(spec, project)).toThrow(/must be \.html, \.js, or \.json/i);
  });
});

import { SpecSchema } from "../src/spec/schema.js";

describe("SpecSchema motion graphics", () => {
  it("parses a motion segment with params/keyframes/triggers", () => {
    const spec = SpecSchema.parse({
      title: "t", segments: [
        { kind: "motion", source: "motion/stat.html", text: "eighty six percent",
          params: { pct: 0 }, keyframes: [{ at: 0.2, params: { pct: 86 }, ease: "overshoot" }],
          triggers: [{ at: 0.2, action: "pulse" }] },
      ],
    });
    expect(spec.segments[0]).toMatchObject({ kind: "motion", source: "motion/stat.html" });
  });
  it("parses a motionOverlay on an app segment", () => {
    const spec = SpecSchema.parse({
      title: "t", segments: [
        { kind: "app", asset: "screens/x.png", text: "look", caption: "c",
          motionOverlay: { source: "motion/callout.html", params: { x: 50 } } },
      ],
    });
    expect((spec.segments[0] as any).motionOverlay.source).toBe("motion/callout.html");
  });
  it("rejects a motion segment missing source", () => {
    expect(() => SpecSchema.parse({ title: "t", segments: [{ kind: "motion", text: "x" }] })).toThrow();
  });
});

import { motionHelpText } from "../src/commands/motion.js";

describe("kino motion help", () => {
  it("documents the core CSS-variable contract and the rules", () => {
    const t = motionHelpText();
    expect(t).toMatch(/--progress/);
    expect(t).toMatch(/--pulse/);
    expect(t).toMatch(/--kino-mint/);
    expect(t).toMatch(/@keyframes/); // the scrub example uses @keyframes
    expect(t).toMatch(/kino-anim/); // the @keyframes scrub recipe
    expect(t).toMatch(/kino-cliptext/); // the background-clip:text glyph-edge helper
    expect(t).toMatch(/render\(env\)/); // the procedural (.js) section
    expect(t).toMatch(/\.js/);
    expect(t).toMatch(/data:/); // inline assets guidance
    expect(t).toMatch(/stagger/i); // staggering guidance
    expect(t).toMatch(/sibling-index/); // the auto-stagger recipe
    expect(t).toMatch(/--kino-caption-bottom/); // the caption-band var so authors avoid the caption
  });
  it("documents the CSS helper kit (reveals, pulse, fade-edges, easing tokens)", () => {
    const t = motionHelpText();
    expect(t).toMatch(/kino-rise/);
    expect(t).toMatch(/kino-pop/);
    expect(t).toMatch(/kino-pulse/);
    expect(t).toMatch(/kino-fade-edges/);
    expect(t).toMatch(/--kino-ease-/);
    expect(t).toMatch(/kino-grain/);
    expect(t).toMatch(/kino-vignette/);
    expect(t).toMatch(/url\(#kino-displace\)/);
  });
  it("documents the Tier-3 Lottie option and its rules", () => {
    const t = motionHelpText();
    expect(t).toMatch(/lottie/i);
    expect(t).toMatch(/\.json/);
    expect(t).toMatch(/loop/);
    expect(t).toMatch(/transparent/i); // overlay-background rule
  });
});
