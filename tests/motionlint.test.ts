import { describe, it, expect } from "vitest";
import {
  lintPinnedClamps,
  lintDeadVisuals,
  lintAnimScrubClass,
  lintUnresolvedFilterRefs,
  lintBackfaceVisibility,
} from "../src/render/motionLint.js";
import { lintMotionSource } from "../src/render/motiongraphic.js";

describe("lintPinnedClamps", () => {
  it("flags the max-below-min form that pins the value to the min", () => {
    // The real defect: a whole beat's signature effect invisible in every frame.
    const css = ".smear { opacity: clamp(0, calc((var(--progress) - .22) * 5.5), 0); }";
    const found = lintPinnedClamps(css);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/pinned to 0/);
    expect(found[0]).toMatch(/UPPER bound/);
  });

  it("flags equal bounds too — the middle value is still ignored", () => {
    expect(lintPinnedClamps("a { opacity: clamp(1, var(--x), 1); }")).toHaveLength(1);
  });

  it("passes the correct form", () => {
    expect(lintPinnedClamps(".glyph { opacity: clamp(0, calc(1 - var(--progress)), 1); }")).toEqual([]);
  });

  it("handles nested parens and commas in the middle argument", () => {
    // A top-level-comma split is required: var(--d, .5) and calc() both contain commas/parens.
    const css = "a { opacity: clamp(0, calc(var(--progress) * var(--k, 2)), 1); }";
    expect(lintPinnedClamps(css)).toEqual([]);
    const bad = "a { opacity: clamp(0, calc(var(--progress) * var(--k, 2)), 0); }";
    expect(lintPinnedClamps(bad)).toHaveLength(1);
  });

  it("compares units and ignores mismatched or un-evaluatable bounds", () => {
    expect(lintPinnedClamps("a { width: clamp(10px, 5vw, 5px); }")).toHaveLength(1);
    // Different units — not statically decidable, so not flagged.
    expect(lintPinnedClamps("a { width: clamp(10px, 5vw, 2rem); }")).toEqual([]);
    // A var() bound can't be judged at lint time.
    expect(lintPinnedClamps("a { opacity: clamp(0, var(--x), var(--hi)); }")).toEqual([]);
  });

  it("finds every occurrence, including several in one rule block", () => {
    const css = "a{opacity:clamp(0,var(--a),0)} b{opacity:clamp(0,var(--b),0)} c{opacity:clamp(0,var(--c),1)}";
    expect(lintPinnedClamps(css)).toHaveLength(2);
  });

  it("ignores the 2-arg and 1-arg forms and unbalanced parens", () => {
    expect(lintPinnedClamps("a { opacity: clamp(0, 1); }")).toEqual([]);
    expect(lintPinnedClamps("a { opacity: clamp(0, var(--x), 1; }")).toEqual([]);
  });

  it("accepts signed and decimal bounds", () => {
    expect(lintPinnedClamps("a { translate: clamp(-1, var(--x), -2); }")).toHaveLength(1);
    expect(lintPinnedClamps("a { opacity: clamp(.5, var(--x), .25); }")).toHaveLength(1);
    expect(lintPinnedClamps("a { opacity: clamp(.25, var(--x), .5); }")).toEqual([]);
  });
});

describe("lintDeadVisuals via lintMotionSource", () => {
  it("rejects a pinned clamp in a Tier-1 HTML source", () => {
    const html = "<style>.s{opacity:clamp(0,var(--progress),0)}</style><div class='s'></div>";
    expect(lintMotionSource("motion/x.html", html).join(" ")).toMatch(/pinned to 0/);
  });

  it("rejects a pinned clamp emitted from a Tier-2 JS source", () => {
    const js = "function render(env){return '<style>.s{opacity:clamp(0,var(--t),0)}</style>'}";
    expect(lintMotionSource("motion/x.js", js).join(" ")).toMatch(/pinned to 0/);
  });

  it("leaves a clean source clean", () => {
    const html = "<style>.s{opacity:clamp(0,var(--progress),1)}</style><div class='s'></div>";
    expect(lintMotionSource("motion/x.html", html)).toEqual([]);
  });

  it("is exported as the aggregate check", () => {
    expect(lintDeadVisuals("a{opacity:clamp(0,var(--x),0)}")).toHaveLength(1);
  });
});

describe("lintBackfaceVisibility", () => {
  // The foreignObject raster honours perspective / translateZ / preserve-3d but drops the backface
  // cull, so the flip idiom renders both faces stacked and only misbehaves once the card turns.
  it("flags the card-flip idiom", () => {
    const css = ".front{backface-visibility:hidden}.back{backface-visibility:hidden;transform:rotateY(180deg)}";
    const found = lintBackfaceVisibility(css);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/silently ignored/);
  });

  it("names the opacity-gate substitute rather than just refusing", () => {
    const found = lintBackfaceVisibility("a{backface-visibility:hidden}");
    expect(found[0]).toMatch(/opacity: clamp/);
    expect(found[0]).toMatch(/preserve-3d/);
  });

  it("catches the -webkit- prefix and loose whitespace", () => {
    expect(lintBackfaceVisibility("a{ -webkit-backface-visibility : hidden }")).toHaveLength(1);
  });

  it("reports once per source, not once per declaration", () => {
    expect(lintBackfaceVisibility("a{backface-visibility:hidden}b{backface-visibility:hidden}")).toHaveLength(1);
  });

  it("ignores the broken line left in a comment", () => {
    // An author who reads the rule and comments the line out shouldn't fail on their own note.
    expect(lintBackfaceVisibility("a{ /* backface-visibility: hidden; ignored — gating opacity */ }")).toEqual([]);
    expect(lintBackfaceVisibility("<!-- backface-visibility:hidden does nothing here --><div></div>")).toEqual([]);
    expect(lintBackfaceVisibility("// backface-visibility: hidden is dropped by the raster\nreturn ''")).toEqual([]);
  });

  it("still flags a live declaration sitting next to a comment", () => {
    expect(lintBackfaceVisibility("/* note */ a{backface-visibility:hidden}")).toHaveLength(1);
  });

  it("does not treat a URL's // as a comment", () => {
    const css = "a{background:url(data:image/svg+xml,%3Csvg/%3E)}b{backface-visibility:hidden}";
    expect(lintBackfaceVisibility(css)).toHaveLength(1);
  });

  it("leaves the harmless default alone", () => {
    // `visible` is the initial value — writing it explicitly changes nothing and is not a trap.
    expect(lintBackfaceVisibility("a{backface-visibility:visible}")).toEqual([]);
  });

  it("leaves 3D that does work alone", () => {
    const css = ".s{perspective:800px}.c{transform-style:preserve-3d;transform:rotateY(40deg) translateZ(120px)}";
    expect(lintBackfaceVisibility(css)).toEqual([]);
  });

  it("rejects through both tiers", () => {
    const html = "<style>.f{backface-visibility:hidden}</style><div class='f'></div>";
    expect(lintMotionSource("motion/x.html", html).join(" ")).toMatch(/silently ignored/);
    const js = "return '<style>.f{backface-visibility:hidden}</style>'";
    expect(lintMotionSource("motion/x.js", js).join(" ")).toMatch(/silently ignored/);
  });
});

describe("lintAnimScrubClass", () => {
  // The defect: the class sits on a WRAPPER while the animation sits on the children. kino only
  // scrubs elements carrying the class, so the children keep CSS's default animation-duration of
  // 0s and paint their END state from frame 0 — the beat looks "already landed", not broken.
  const wrapperMistake =
    "<style>.ch{animation-name:fall}@keyframes fall{0%{opacity:0}100%{opacity:1}}</style>" +
    '<div class="wrap kino-anim"><span class="ch">O</span><span class="ch">K</span></div>';

  it("flags an animated class whose elements never carry a scrub class", () => {
    const found = lintAnimScrubClass(wrapperMistake);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/\.ch/);
    expect(found[0]).toMatch(/kino-anim/);
  });

  it("passes once the class is on the animated element itself", () => {
    const fixed = wrapperMistake.replace(/class="ch"/g, 'class="ch kino-anim"');
    expect(lintAnimScrubClass(fixed)).toEqual([]);
  });

  it("accepts a built-in helper class as the scrub", () => {
    const html =
      "<style>.item{animation-name:pop}</style><div class=\"item kino-pop\">x</div>";
    expect(lintAnimScrubClass(html)).toEqual([]);
  });

  it("understands the animation shorthand, not just animation-name", () => {
    const html = "<style>.x{animation:slide 1s both}</style><div class=\"x\">a</div>";
    expect(lintAnimScrubClass(html)).toHaveLength(1);
  });

  it("stays quiet when the animated class appears in no markup — undecidable, not wrong", () => {
    expect(lintAnimScrubClass("<style>.ghost{animation-name:fade}</style><div>x</div>")).toEqual([]);
  });

  it("stays quiet on a source with no animations at all", () => {
    expect(lintAnimScrubClass('<style>.a{opacity:var(--progress)}</style><div class="a">x</div>')).toEqual([]);
  });

  it("matches class attributes by whole token, so .ch does not match class=\"church\"", () => {
    const html = '<style>.ch{animation-name:f}</style><div class="church">x</div>';
    expect(lintAnimScrubClass(html)).toEqual([]);
  });

  it("flags through lintMotionSource on a Tier-1 HTML source", () => {
    expect(lintMotionSource("motion/x.html", wrapperMistake).join(" ")).toMatch(/kino-anim/);
  });
});

describe("lintUnresolvedFilterRefs", () => {
  it("flags a url(#id) whose id is defined nowhere — the layer renders NOTHING, silently", () => {
    const html = '<style>.g{filter:url(#gC)}</style><div class="g"></div>';
    const found = lintUnresolvedFilterRefs(html);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/#gC/);
  });

  it("passes when the filter is defined in the same source", () => {
    const html =
      '<svg width="0" height="0"><defs><filter id="gC"></filter></defs></svg>' +
      '<style>.g{filter:url(#gC)}</style><div class="g"></div>';
    expect(lintUnresolvedFilterRefs(html)).toEqual([]);
  });

  it("allows the filters kino injects into every motion page", () => {
    const html = "<style>.a{filter:url(#kino-grain)}.b{filter:url(#kino-rgb)}.c{filter:url(#kino-smear-x-lg)}</style>";
    expect(lintUnresolvedFilterRefs(html)).toEqual([]);
  });

  it("handles the attribute form as well as the CSS form", () => {
    expect(lintUnresolvedFilterRefs('<rect filter="url(#nope)"/>')).toHaveLength(1);
  });

  it("covers mask and clip-path refs, which fail the same way", () => {
    expect(lintUnresolvedFilterRefs("<style>.m{mask:url(#mm)}</style>")).toHaveLength(1);
    expect(lintUnresolvedFilterRefs("<style>.m{clip-path:url(#cc)}</style>")).toHaveLength(1);
  });

  it("ignores refs inside a data: URI — those resolve within that document, not this one", () => {
    const html = "<style>.a{background:url(\"data:image/svg+xml,%3Csvg%3E%3Cfilter id='x'%3E url(%23x)\")}</style>";
    expect(lintUnresolvedFilterRefs(html)).toEqual([]);
  });

  it("reports each missing id once, not once per reference", () => {
    const html = "<style>.a{filter:url(#miss)}.b{filter:url(#miss)}</style>";
    expect(lintUnresolvedFilterRefs(html)).toHaveLength(1);
  });
});

describe("lintAnimScrubClass — selector subject", () => {
  // Regression: reading EVERY class in the selector flagged assets-lib/motion/settle.html, which is
  // correct code. `.line span` animates the spans; the spans carry kino-anim, the .line parent does
  // not, and only the subject (rightmost compound) is the animated element.
  it("judges the rightmost compound, not every class in the selector", () => {
    const html =
      "<style>.line span{animation-name:rise}</style>" +
      '<div class="line"><span class="kino-anim">a</span><span class="kino-anim">b</span></div>';
    expect(lintAnimScrubClass(html)).toEqual([]);
  });

  it("still flags a descendant selector whose subject class lacks the scrub", () => {
    const html = '<style>.wrap .ch{animation-name:fall}</style><div class="wrap"><i class="ch">a</i></div>';
    expect(lintAnimScrubClass(html)).toHaveLength(1);
  });

  it("skips a subject with no class of its own — undecidable from text", () => {
    expect(lintAnimScrubClass("<style>.line span{animation-name:r}</style><div class='line'><span>a</span></div>")).toEqual([]);
  });

  it("requires an element to carry every class of a compound subject", () => {
    const both = '<style>.a.b{animation-name:x}</style><div class="a b kino-anim">y</div>';
    expect(lintAnimScrubClass(both)).toEqual([]);
    const missing = '<style>.a.b{animation-name:x}</style><div class="a b">y</div>';
    expect(lintAnimScrubClass(missing)).toHaveLength(1);
  });
});

describe("lintMotionSource surface", () => {
  // A rasterized texture channel advances its own @keyframes via the re-raster param, so bare
  // animation-name with no scrub class is correct there — the check must not run.
  const textureish = "<style>.l1{animation:t1 1s linear both}</style><div class=\"row l1\">x</div>";

  it("applies the scrub-placement check on a beat", () => {
    expect(lintMotionSource("motion/x.html", textureish, "beat").join(" ")).toMatch(/scrub class/);
  });

  it("skips it on a rasterized texture channel", () => {
    expect(lintMotionSource("motion/x.html", textureish, "texture")).toEqual([]);
  });

  it("defaults to the beat surface", () => {
    expect(lintMotionSource("motion/x.html", textureish).join(" ")).toMatch(/scrub class/);
  });
});

describe("Tier-2 doubled-plus lint", () => {
  // `'x' + + f()` is a unary plus: the returned markup is coerced to a Number and emitted as the
  // literal string "NaN". When that markup was a <filter> def, every layer referencing it vanishes.
  it("flags a continuation line that starts with two pluses", () => {
    const js = "return ''\n+ grainFilter('gA')\n+   + grainFilter('gB')\n+ '</defs>';";
    expect(lintMotionSource("motion/x.js", js).join(" ")).toMatch(/unary plus/);
  });

  it("leaves an ordinary single-plus concat chain alone", () => {
    const js = "return ''\n+ '<div>'\n+ '</div>';";
    expect(lintMotionSource("motion/x.js", js)).toEqual([]);
  });

  it("does not flag increment operators", () => {
    const js = "var o='';for(var i=0;i<3;i++){o+='<i></i>'}\nreturn o;";
    expect(lintMotionSource("motion/x.js", js)).toEqual([]);
  });
});
