import { describe, it, expect } from "vitest";
import { lintMotionHtml, sanitizeMotionHtml, resolveMotionGraphic } from "../src/render/motiongraphic.js";
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
    expect(t).toMatch(/@keyframes/); // names what is banned
    expect(t).toMatch(/data:/); // inline assets guidance
    expect(t).toMatch(/stagger/i); // staggering guidance
    expect(t).toMatch(/sibling-index/); // the auto-stagger recipe
  });
});
