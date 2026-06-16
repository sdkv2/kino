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
  it("rejects @keyframes", () => {
    expect(lintMotionHtml(`<style>@keyframes x{from{opacity:0}}</style>`)[0]).toMatch(/keyframes/i);
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
      `<style>.b{animation:spin 1s}</style>`,
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
});

describe("sanitizeMotionHtml", () => {
  it("strips <script> and event handlers but keeps <style> + structure", () => {
    const out = sanitizeMotionHtml(`<style>.b{color:red}</style><div class="b" onclick="x()">hi</div><script>bad()</script>`);
    expect(out).toContain("<style>");
    expect(out).toContain("hi");
    expect(out).not.toMatch(/script/i);
    expect(out).not.toMatch(/onclick/i);
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
    const project = projWith("motion/bad.html", `<style>@keyframes x{from{opacity:0}}</style>`);
    expect(() => resolveMotionGraphic({ source: "motion/bad.html" }, project)).toThrow(/keyframes/i);
  });
});
