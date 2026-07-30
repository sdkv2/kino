import { describe, it, expect } from "vitest";
import {
  implySmearOptIn,
  hasVelocityTargets,
  annotateVelocityTargets,
  SMEAR_CLASS,
  VEL_ATTR,
} from "../src/render/motionVelocity.js";
import { motionScrubCss } from "../src/render/native/page/motionCss.js";

describe("kino-smear opt-in", () => {
  it("is recognised by the cheap gate, so the class alone arms the measurement pass", () => {
    expect(hasVelocityTargets(`<div class="${SMEAR_CLASS}"></div>`)).toBe(true);
    expect(hasVelocityTargets('<div class="pill"></div>')).toBe(false);
  });

  it("gives a .kino-smear element the measurement attribute", () => {
    const out = implySmearOptIn(`<div class="pan ${SMEAR_CLASS}"></div>`);
    expect(out).toContain(VEL_ATTR);
  });

  it("does not double up when the author wrote both", () => {
    const html = `<div class="${SMEAR_CLASS}" ${VEL_ATTR}></div>`;
    expect(implySmearOptIn(html).match(new RegExp(VEL_ATTR, "g"))).toHaveLength(1);
  });

  it("leaves elements without the class alone", () => {
    const html = '<div class="pan"></div><span>x</span>';
    expect(implySmearOptIn(html)).toBe(html);
  });

  it("does not fire on a class that merely contains the name", () => {
    // `kino-smearless` is a different class; a substring match would arm the whole pass for nothing.
    const html = '<div class="kino-smearless"></div>';
    expect(implySmearOptIn(html)).toBe(html);
  });

  it("handles single quotes and a self-closing tag", () => {
    expect(implySmearOptIn(`<path class='${SMEAR_CLASS}'/>`)).toContain(VEL_ATTR);
    expect(implySmearOptIn(`<path class='${SMEAR_CLASS}'/>`)).toMatch(/\/>$/);
  });

  it("composes with the index annotation the probe pairs elements by", () => {
    const html = `<i class="${SMEAR_CLASS}">a</i><i class="${SMEAR_CLASS}">b</i>`;
    const { html: out, count } = annotateVelocityTargets(implySmearOptIn(html));
    expect(count).toBe(2);
    expect(out).toContain(`${VEL_ATTR}="0"`);
    expect(out).toContain(`${VEL_ATTR}="1"`);
  });

  it("arms measurement for a whole page that only uses the class", () => {
    const page = `<div class="pan ${SMEAR_CLASS}" style="transform:translateX(40px)"></div>`;
    expect(hasVelocityTargets(page)).toBe(true);
    expect(annotateVelocityTargets(implySmearOptIn(page)).count).toBe(1);
  });
});

describe("kino-smear CSS", () => {
  const css = motionScrubCss("#host");

  it("drives blur off the measured speed with a zero fallback", () => {
    expect(css).toContain(".kino-smear{");
    expect(css).toMatch(/var\(--kino-vel,0\)/);
  });

  it("is capped, so a whip pan softens instead of dissolving", () => {
    expect(css).toMatch(/var\(--kino-smear-max,18\)/);
    expect(css).toMatch(/min\(/);
  });

  it("exposes strength as an overridable custom property", () => {
    expect(css).toMatch(/var\(--kino-smear,\.05\)/);
  });
});

describe("self-closing tags keep closing", () => {
  it("writeVelocityVars does not strand the slash mid-tag", async () => {
    const { writeVelocityVars } = await import("../src/render/motionVelocity.js");
    const out = writeVelocityVars(`<path ${VEL_ATTR}="0" d="M0,0H9"/>`, ["--kino-vel:3"]);
    // `<path …/ style="…">` would un-close the element and swallow its siblings.
    expect(out).toMatch(/\/>$/);
    expect(out).toContain("--kino-vel:3");
    expect(out).not.toMatch(/\/\s+style=/);
  });
});

describe("annotation is scoped to tags", () => {
  it("does not rewrite the attribute name where it appears as visible text", async () => {
    const { annotateVelocityTargets } = await import("../src/render/motionVelocity.js");
    // A graphic explaining kino would otherwise render `data-kino-vel="0"` in its own copy.
    const html = `<p>set ${VEL_ATTR} on it</p><b ${VEL_ATTR}>x</b>`;
    const out = annotateVelocityTargets(html);
    expect(out.count).toBe(1);
    expect(out.html).toContain(`set ${VEL_ATTR} on it`);
    expect(out.html).toContain(`<b ${VEL_ATTR}="0">`);
  });

  it("does not count an occurrence inside a style block", async () => {
    const { annotateVelocityTargets } = await import("../src/render/motionVelocity.js");
    const html = `<style>.a{width:calc(var(--kino-vel) * 1px)}</style><i ${VEL_ATTR}>a</i>`;
    expect(annotateVelocityTargets(html).count).toBe(1);
  });
});
