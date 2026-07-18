# Stylised Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Caption style presets (`stroke|highlight|gradient|minimal`), text animation presets (`pop|rise|typewriter|wave|blur-in|none`), and simple standalone text overlays (`texts` array per segment), agent-authorable via spec/brand.

**Architecture:** One new pure module `src/render/textStyles.ts` holds every preset (style CSS, animation math) plus the build-time resolvers. Zod schema + brand frontmatter gain enum fields; `build.ts` resolves them onto `KinoSegment`; the three caption components consume presets instead of hardcoded styles; one new `TextOverlay` component renders resolved `texts`.

**Spec:** `docs/superpowers/specs/2026-07-18-stylised-text-design.md`

**Tech Stack:** TypeScript strict ESM (imports use `.js` suffix), zod 3, Remotion 4, vitest. Run tests with `npx vitest run tests/<file>.test.ts`, typecheck with `npx tsc --noEmit`.

## Global Constraints

- **Regression gate:** with nothing new set in spec/brand, rendered output must be pixel-identical to today. Components keep their exact legacy inline math for their *native* entrance (pop for `Caption`/`WordCaption`, rise for `HeroCaption`) and use it when the animation is unset or equals the native one.
- **Unset animation = surface native.** `resolveCaptionLook` returns `animation: undefined` when no layer sets it; hero then rises, others pop. (Refinement of the spec's "default pop" — a global "pop" default would change hero beats.)
- No new dependencies. No new React test infra — pure functions carry the logic; components are thin consumers verified by the existing `renderVideo` smoke tests + `tsc`.
- Fewest files: presets + resolvers in `src/render/textStyles.ts`; `TextOverlay` in `src/render/remotion/components.tsx`.
- `src/spec/schema.ts` header mandates: schema changes ship with `docs/spec-reference.md` updates (Task 6).
- Commit messages: conventional commits, end body with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `textStyles.ts` pure module

**Files:**
- Create: `src/render/textStyles.ts`
- Test: `tests/textstyles.test.ts`

**Interfaces (Produces):**
```ts
export const CAPTION_STYLES: readonly ["stroke", "highlight", "gradient", "minimal"];
export const CAPTION_ANIMATIONS: readonly ["pop", "rise", "typewriter", "wave", "blur-in", "none"];
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];
export interface TextTheme { night: string; mint: string; green: string; white: string; captionStroke: number }
export interface WordFlags { highlight?: boolean; emph?: boolean; shadow?: string }
export function wordStyle(style: CaptionStyle, t: TextTheme, flags?: WordFlags): CSSProperties;
export function lineBoxStyle(style: CaptionStyle, t: TextTheme, backplateBg?: string | null): CSSProperties;
export interface AnimInput { s: number; frame: number; index: number }
export interface AnimOut { transform: string; opacity: number; filter?: string }
export function animatePreset(anim: CaptionAnimation, a: AnimInput): AnimOut;
export function composeFilters(...fs: Array<string | undefined>): string | undefined;
export function resolveCaptionLook(seg, spec, brand?): { style: CaptionStyle; animation?: CaptionAnimation };
export const TEXT_SIZES: Record<"small" | "medium" | "big", number>;      // multipliers of captionFontSize
export const TEXT_POSITIONS: Record<"top" | "center" | "bottom" | "left" | "right", { x: number; y: number }>;
export interface SpecText { text: string; at: number; dur?: number; position: keyof typeof TEXT_POSITIONS; size: keyof typeof TEXT_SIZES; style?: CaptionStyle; animation?: CaptionAnimation }
export interface ResolvedText { text: string; fromSec: number; durSec: number; x: number; y: number; sizePx: number; style: CaptionStyle; animation: CaptionAnimation }
export function resolveTexts(texts: SpecText[] | undefined, segStartSec: number, segEndSec: number, captionFontSize: number, fallback: { style: CaptionStyle; animation?: CaptionAnimation }): ResolvedText[] | undefined;
```
`TextTheme` is a structural subset of `Theme` (`props.ts`) — no import, so `props.ts` may later import from this module without a cycle.

- [ ] **Step 1: Write the failing test**

Create `tests/textstyles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  wordStyle, lineBoxStyle, animatePreset, composeFilters, resolveCaptionLook, resolveTexts,
  TEXT_POSITIONS, TEXT_SIZES,
} from "../src/render/textStyles.js";

const t = { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", white: "#ffffff", captionStroke: 9 };

describe("wordStyle", () => {
  it("stroke reproduces the legacy caption ink exactly", () => {
    expect(wordStyle("stroke", t)).toEqual({
      color: "#ffffff",
      fontWeight: 900,
      WebkitTextStroke: "9px #000",
      paintOrder: "stroke fill",
      textShadow: "0 6px 18px rgba(0,0,0,.45)",
    });
  });
  it("stroke honours highlight (mint ink), emph (glow), and a shadow override", () => {
    expect(wordStyle("stroke", t, { highlight: true }).color).toBe("#80e2b4");
    expect(wordStyle("stroke", t, { emph: true }).textShadow).toBe("0 0 26px #80e2b4");
    expect(wordStyle("stroke", t, { shadow: "0 6px 20px rgba(0,0,0,.45)" }).textShadow).toBe("0 6px 20px rgba(0,0,0,.45)");
  });
  it("highlight boxes the highlighted word (night ink on mint), leaves others unboxed", () => {
    const on = wordStyle("highlight", t, { highlight: true });
    expect(on.backgroundColor).toBe("#80e2b4");
    expect(on.color).toBe("#0b1020");
    expect(on.borderRadius).toBe(14);
    const off = wordStyle("highlight", t);
    expect(off.backgroundColor).toBeUndefined();
    expect(off.color).toBe("#ffffff");
    expect(off.WebkitTextStroke).toBeUndefined();
  });
  it("gradient clips a mint→green fill to the text and drops the stroke", () => {
    const s = wordStyle("gradient", t);
    expect(s.backgroundImage).toBe("linear-gradient(100deg, #80e2b4, #0c8d64)");
    expect(s.WebkitBackgroundClip).toBe("text");
    expect(s.WebkitTextFillColor).toBe("transparent");
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(s.filter).toBe("drop-shadow(0 6px 14px rgba(0,0,0,.5))");
    expect(wordStyle("gradient", t, { emph: true }).filter).toBe("drop-shadow(0 0 18px #80e2b4)");
  });
  it("minimal is 700-weight, strokeless", () => {
    const s = wordStyle("minimal", t);
    expect(s.fontWeight).toBe(700);
    expect(s.WebkitTextStroke).toBeUndefined();
    expect(wordStyle("minimal", t, { highlight: true }).color).toBe("#80e2b4");
  });
});

describe("lineBoxStyle", () => {
  it("highlight gets an opaque night line box", () => {
    expect(lineBoxStyle("highlight", t)).toEqual({ display: "inline-block", backgroundColor: "#0b1020", padding: "12px 32px", borderRadius: 30 });
  });
  it("other styles box only when a backplate colour is supplied (legacy plateStyle)", () => {
    expect(lineBoxStyle("stroke", t)).toEqual({});
    expect(lineBoxStyle("stroke", t, "#0b1020d1")).toEqual({ display: "inline-block", backgroundColor: "#0b1020d1", padding: "12px 32px", borderRadius: 30 });
  });
});

describe("animatePreset", () => {
  it("pop scales 0.7→1 with the spring and fades in over its first half", () => {
    expect(animatePreset("pop", { s: 0, frame: 0, index: 0 })).toEqual({ transform: "scale(0.7)", opacity: 0 });
    expect(animatePreset("pop", { s: 1, frame: 10, index: 0 })).toEqual({ transform: "scale(1)", opacity: 1 });
  });
  it("rise translates 44px→0 (legacy hero formula)", () => {
    expect(animatePreset("rise", { s: 0, frame: 0, index: 0 }).transform).toBe("translateY(44px)");
    expect(animatePreset("rise", { s: 1, frame: 10, index: 0 }).transform).toBe("translateY(0px)");
  });
  it("typewriter and none reveal instantly at frame 0, hidden before", () => {
    for (const anim of ["typewriter", "none"] as const) {
      expect(animatePreset(anim, { s: 0, frame: -1, index: 0 }).opacity).toBe(0);
      expect(animatePreset(anim, { s: 0, frame: 0, index: 0 }).opacity).toBe(1);
    }
  });
  it("blur-in sharpens 12px→0 with the spring", () => {
    expect(animatePreset("blur-in", { s: 0, frame: 0, index: 0 }).filter).toBe("blur(12px)");
    expect(animatePreset("blur-in", { s: 1, frame: 10, index: 0 }).filter).toBe("blur(0px)");
  });
  it("wave bobs settled words on a per-index phase", () => {
    const a = animatePreset("wave", { s: 1, frame: 30, index: 0 });
    const b = animatePreset("wave", { s: 1, frame: 30, index: 2 });
    expect(a.transform).toContain("translateY(");
    expect(a.transform).not.toBe(b.transform); // phase offset by index
    expect(animatePreset("wave", { s: 0, frame: 0, index: 0 }).opacity).toBe(0);
  });
});

describe("composeFilters", () => {
  it("joins real filters, drops none/undefined, and returns undefined when empty", () => {
    expect(composeFilters("drop-shadow(0 0 2px red)", "blur(3px)")).toBe("drop-shadow(0 0 2px red) blur(3px)");
    expect(composeFilters(undefined, "none")).toBeUndefined();
  });
});

describe("resolveCaptionLook", () => {
  const brand = { style: "minimal", animation: "rise" } as const;
  it("layers segment over spec over brand over defaults", () => {
    expect(resolveCaptionLook({}, {}, undefined)).toEqual({ style: "stroke", animation: undefined });
    expect(resolveCaptionLook({}, {}, brand)).toEqual({ style: "minimal", animation: "rise" });
    expect(resolveCaptionLook({}, { captionStyle: "gradient", captionAnimation: "wave" }, brand)).toEqual({ style: "gradient", animation: "wave" });
    expect(resolveCaptionLook({ captionStyle: "highlight", captionAnimation: "pop" }, { captionStyle: "gradient" }, brand)).toEqual({ style: "highlight", animation: "pop" });
  });
});

describe("resolveTexts", () => {
  const fallback = { style: "stroke", animation: undefined } as const;
  it("returns undefined for missing/empty input", () => {
    expect(resolveTexts(undefined, 0, 5, 74, fallback)).toBeUndefined();
    expect(resolveTexts([], 0, 5, 74, fallback)).toBeUndefined();
  });
  it("maps slots, sizes, and defaults style/animation from the fallback", () => {
    const [r] = resolveTexts([{ text: "3× faster", at: 1, position: "top", size: "big", style: "gradient", animation: "blur-in" }], 10, 15, 74, fallback)!;
    expect(r).toEqual({ text: "3× faster", fromSec: 11, durSec: 4, x: 50, y: 16, sizePx: 111, style: "gradient", animation: "blur-in" });
    const [d] = resolveTexts([{ text: "x", at: 0, position: "center", size: "medium" }], 0, 2, 74, { style: "minimal", animation: "wave" })!;
    expect(d.style).toBe("minimal");
    expect(d.animation).toBe("wave");
    expect(d.sizePx).toBe(74);
    expect(d).toMatchObject(TEXT_POSITIONS.center);
  });
  it("defaults animation to pop when the fallback has none (surface-native doesn't exist for overlays)", () => {
    const [r] = resolveTexts([{ text: "x", at: 0, position: "center", size: "small" }], 0, 2, 74, fallback)!;
    expect(r.animation).toBe("pop");
    expect(r.sizePx).toBe(Math.round(74 * TEXT_SIZES.small));
  });
  it("clamps dur to the segment end and drops entries that start after it", () => {
    const [r] = resolveTexts([{ text: "x", at: 1, dur: 99, position: "center", size: "medium" }], 0, 3, 74, fallback)!;
    expect(r.durSec).toBe(2);
    expect(resolveTexts([{ text: "x", at: 5, position: "center", size: "medium" }], 0, 3, 74, fallback)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/textstyles.test.ts`
Expected: FAIL — `Cannot find module '../src/render/textStyles.js'`

- [ ] **Step 3: Write the implementation**

Create `src/render/textStyles.ts`:

```ts
// Text preset library + build-time resolvers for stylised captions and overlays. Pure module
// (compiled-land, like captionLayout.ts): the CLI resolves specs through it and the Remotion
// components style words with it. Presets draw only from the resolved brand palette.
// Spec: docs/superpowers/specs/2026-07-18-stylised-text-design.md
import type { CSSProperties } from "react";

export const CAPTION_STYLES = ["stroke", "highlight", "gradient", "minimal"] as const;
export const CAPTION_ANIMATIONS = ["pop", "rise", "typewriter", "wave", "blur-in", "none"] as const;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

// Structural subset of Theme (props.ts) — kept import-free so props.ts can import from here.
export interface TextTheme {
  night: string;
  mint: string;
  green: string;
  white: string;
  captionStroke: number;
}

// highlight = this word takes the accent (active/brand word in words mode); emph = extra glow
// (active + emphasised); shadow = surface-specific drop shadow (each caption surface keeps its
// legacy value so the default render stays pixel-identical).
export interface WordFlags {
  highlight?: boolean;
  emph?: boolean;
  shadow?: string;
}

// Per-word ink: colour/weight/stroke/shadow (and box, for highlight) for one style preset.
export function wordStyle(style: CaptionStyle, t: TextTheme, flags: WordFlags = {}): CSSProperties {
  const { highlight = false, emph = false, shadow = "0 6px 18px rgba(0,0,0,.45)" } = flags;
  switch (style) {
    case "highlight":
      // CapCut-style: the accented word sits in a rounded mint box with night ink; the rest is
      // plain white (no stroke — the box carries the contrast).
      return highlight
        ? { color: t.night, backgroundColor: t.mint, borderRadius: 14, padding: "0px 16px", fontWeight: 900 }
        : { color: t.white, fontWeight: 900, textShadow: shadow };
    case "gradient":
      // background-clip fill conflicts with text stroke and textShadow — legibility comes from a
      // drop-shadow filter instead.
      return {
        fontWeight: 900,
        backgroundImage: `linear-gradient(100deg, ${t.mint}, ${t.green})`,
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        filter: emph ? `drop-shadow(0 0 18px ${t.mint})` : "drop-shadow(0 6px 14px rgba(0,0,0,.5))",
      };
    case "minimal":
      return { color: highlight ? t.mint : t.white, fontWeight: 700, textShadow: "0 4px 14px rgba(0,0,0,.35)" };
    default:
      // "stroke" — the legacy look, byte-for-byte.
      return {
        color: highlight ? t.mint : t.white,
        fontWeight: 900,
        WebkitTextStroke: `${t.captionStroke}px #000`,
        paintOrder: "stroke fill" as CSSProperties["paintOrder"],
        textShadow: emph ? `0 0 26px ${t.mint}` : shadow,
      };
  }
}

// Whole-line box: highlight style gets an opaque night plate; otherwise the legacy translucent
// backplate when configured (absorbs components.tsx plateStyle). {} = unchanged look.
export function lineBoxStyle(style: CaptionStyle, t: TextTheme, backplateBg?: string | null): CSSProperties {
  if (style === "highlight") return { display: "inline-block", backgroundColor: t.night, padding: "12px 32px", borderRadius: 30 };
  if (backplateBg) return { display: "inline-block", backgroundColor: backplateBg, padding: "12px 32px", borderRadius: 30 };
  return {};
}

// s = entrance spring 0→1 (caller owns the spring config); frame = frames since this element's
// entrance began (negative = not yet — words mode passes revealFrame); index = word index for
// stagger phase. Callers use these presets only for NON-native animations; native entrances keep
// their legacy inline math (regression gate).
export interface AnimInput {
  s: number;
  frame: number;
  index: number;
}
export interface AnimOut {
  transform: string;
  opacity: number;
  filter?: string;
}

export function animatePreset(anim: CaptionAnimation, a: AnimInput): AnimOut {
  const settle = Math.min(1, a.s); // clamped spring for opacity/blur (no overshoot artefacts)
  switch (anim) {
    case "rise":
      return { transform: `translateY(${(1 - a.s) * 44}px)`, opacity: settle };
    case "typewriter":
      return { transform: "none", opacity: a.frame >= 0 ? 1 : 0 };
    case "wave": {
      // ponytail: fixed 6px bob at ~0.5Hz (30fps), 4-frame phase step per word; entrance rides the spring
      const bob = Math.sin((a.frame - a.index * 4) / 9) * 6 * settle;
      return { transform: `translateY(${bob}px) scale(${0.7 + 0.3 * settle})`, opacity: settle };
    }
    case "blur-in":
      return { transform: "none", opacity: settle, filter: `blur(${(1 - settle) * 12}px)` };
    case "none":
      return { transform: "none", opacity: a.frame >= 0 ? 1 : 0 };
    default:
      // "pop"
      return { transform: `scale(${0.7 + 0.3 * a.s})`, opacity: Math.min(1, a.s * 2) };
  }
}

// CSS `filter` is a single property — merge a style filter (gradient drop-shadow) with an
// animation filter (blur-in) into one value.
export function composeFilters(...fs: Array<string | undefined>): string | undefined {
  const list = fs.filter((f): f is string => !!f && f !== "none");
  return list.length ? list.join(" ") : undefined;
}

// Layered caption look: segment ?? spec ?? brand ?? defaults. animation stays undefined when no
// layer sets it — each surface then keeps its native entrance (pop, or rise for hero text).
export function resolveCaptionLook(
  seg: { captionStyle?: CaptionStyle; captionAnimation?: CaptionAnimation },
  spec: { captionStyle?: CaptionStyle; captionAnimation?: CaptionAnimation },
  brand?: { style?: CaptionStyle; animation?: CaptionAnimation },
): { style: CaptionStyle; animation?: CaptionAnimation } {
  return {
    style: seg.captionStyle ?? spec.captionStyle ?? brand?.style ?? "stroke",
    animation: seg.captionAnimation ?? spec.captionAnimation ?? brand?.animation,
  };
}

// --- Standalone text overlays --------------------------------------------------------------------

// Size names are multipliers of the brand captionFontSize.
export const TEXT_SIZES: Record<"small" | "medium" | "big", number> = { small: 0.7, medium: 1, big: 1.5 };

// Slot → (x, y) % of frame, element anchored at its centre (same convention as LOGO_POSITIONS).
// bottom sits above the caption band (CAPTION_BOTTOM); side slots are inset for 9:16 safe areas.
export const TEXT_POSITIONS: Record<"top" | "center" | "bottom" | "left" | "right", { x: number; y: number }> = {
  top: { x: 50, y: 16 },
  center: { x: 50, y: 45 },
  bottom: { x: 50, y: 72 },
  left: { x: 26, y: 45 },
  right: { x: 74, y: 45 },
};

// A spec `texts[]` entry (post-zod: position/size defaulted).
export interface SpecText {
  text: string;
  at: number;
  dur?: number;
  position: keyof typeof TEXT_POSITIONS;
  size: keyof typeof TEXT_SIZES;
  style?: CaptionStyle;
  animation?: CaptionAnimation;
}

// Render-ready overlay: absolute timeline seconds, % position, px size, resolved presets.
export interface ResolvedText {
  text: string;
  fromSec: number;
  durSec: number;
  x: number;
  y: number;
  sizePx: number;
  style: CaptionStyle;
  animation: CaptionAnimation;
}

// `at` is relative to the segment start; entries are clamped to the beat (an overlay never
// outlives its segment) and dropped when they'd start after it ends.
export function resolveTexts(
  texts: SpecText[] | undefined,
  segStartSec: number,
  segEndSec: number,
  captionFontSize: number,
  fallback: { style: CaptionStyle; animation?: CaptionAnimation },
): ResolvedText[] | undefined {
  if (!texts || texts.length === 0) return undefined;
  const out: ResolvedText[] = [];
  for (const tx of texts) {
    const fromSec = segStartSec + tx.at;
    if (fromSec >= segEndSec) continue;
    const pos = TEXT_POSITIONS[tx.position];
    out.push({
      text: tx.text,
      fromSec,
      durSec: Math.min(tx.dur ?? segEndSec - fromSec, segEndSec - fromSec),
      x: pos.x,
      y: pos.y,
      sizePx: Math.round(captionFontSize * TEXT_SIZES[tx.size]),
      style: tx.style ?? fallback.style,
      animation: tx.animation ?? fallback.animation ?? "pop",
    });
  }
  return out.length ? out : undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/textstyles.test.ts`
Expected: PASS (all describe blocks green)

- [ ] **Step 5: Commit**

```bash
git add src/render/textStyles.ts tests/textstyles.test.ts
git commit -m "feat(render): text style + animation preset library (textStyles.ts)"
```

---

### Task 2: Spec schema + brand frontmatter fields

**Files:**
- Modify: `src/spec/schema.ts`
- Modify: `src/config/brand.ts`
- Test: `tests/spec.test.ts`, `tests/brand.test.ts`

**Interfaces:**
- Consumes: `CAPTION_STYLES`, `CAPTION_ANIMATIONS` from `../render/textStyles.js` (Task 1).
- Produces: `Spec` gains optional `captionStyle` / `captionAnimation` (top level and per segment) and per-segment `texts` (array of the overlay object, `position` default `"center"`, `size` default `"medium"`). Resolved `Brand.captionStyle` gains optional `style` / `animation`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/spec.test.ts` (inside or after the existing `describe`):

```ts
describe("SpecSchema stylised text", () => {
  it("accepts captionStyle/captionAnimation at top level and per segment", () => {
    const s = SpecSchema.parse({
      ...valid,
      captionStyle: "highlight",
      captionAnimation: "wave",
      segments: [{ kind: "avatar", text: "hi", caption: "hi", captionStyle: "gradient", captionAnimation: "blur-in" }],
    });
    expect(s.captionStyle).toBe("highlight");
    expect(s.segments[0].captionStyle).toBe("gradient");
  });
  it("accepts texts overlays and defaults position/size", () => {
    const s = SpecSchema.parse({
      ...valid,
      segments: [{ kind: "avatar", text: "hi", caption: "hi", texts: [{ text: "3× faster", at: 1.2 }] }],
    });
    expect(s.segments[0].texts![0]).toMatchObject({ text: "3× faster", at: 1.2, position: "center", size: "medium" });
  });
  it("rejects unknown style/animation/position values", () => {
    expect(() => SpecSchema.parse({ ...valid, captionStyle: "comic-sans" })).toThrow();
    expect(() =>
      SpecSchema.parse({ ...valid, segments: [{ kind: "avatar", text: "x", caption: "y", texts: [{ text: "z", at: 0, position: "middle" }] }] }),
    ).toThrow();
  });
});
```

Append to `tests/brand.test.ts`:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("brand captionStyle presets", () => {
  it("parses captionStyle.style/.animation and merges over defaults", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-brand-"));
    writeFileSync(
      join(dir, "brand.md"),
      `---\nname: t\ncaptionStyle:\n  style: minimal\n  animation: rise\n---\nbody\n`,
    );
    const b = loadBrand(dir);
    expect(b.captionStyle.style).toBe("minimal");
    expect(b.captionStyle.animation).toBe("rise");
    expect(b.captionStyle.fontSize).toBe(74); // defaults still merged
  });
  it("rejects an unknown style name", () => {
    const dir = mkdtempSync(join(tmpdir(), "kino-brand-"));
    writeFileSync(join(dir, "brand.md"), `---\ncaptionStyle:\n  style: fancy\n---\n`);
    expect(() => loadBrand(dir)).toThrow();
  });
});
```

(Match the file's existing imports — `loadBrand` is already imported there; add the node imports only if missing. `mkdirSync` unneeded if unused — drop it.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/spec.test.ts tests/brand.test.ts`
Expected: FAIL — unknown keys are stripped/rejected (`captionStyle` undefined; `.strict()` brand schema throws on new keys only after we allow them — the assertions on parsed values fail)

- [ ] **Step 3: Implement schema changes**

In `src/spec/schema.ts`:

```ts
import { CAPTION_STYLES, CAPTION_ANIMATIONS } from "../render/textStyles.js";

const CaptionStyle = z.enum(CAPTION_STYLES);
const CaptionAnimation = z.enum(CAPTION_ANIMATIONS);
const TextOverlaySpec = z.object({
  text: z.string().min(1),
  at: z.number().min(0),
  dur: z.number().positive().optional(),
  position: z.enum(["top", "center", "bottom", "left", "right"]).default("center"),
  size: z.enum(["small", "medium", "big"]).default("medium"),
  style: CaptionStyle.optional(),
  animation: CaptionAnimation.optional(),
});
```

Add to **each** of the three segment variants (`avatar`, `app`, `motion`):

```ts
    captionStyle: CaptionStyle.optional(),
    captionAnimation: CaptionAnimation.optional(),
    texts: z.array(TextOverlaySpec).optional(),
```

Add to `SpecSchema` top level (near `background`):

```ts
  captionStyle: CaptionStyle.optional(), // caption look preset (overrides brand.captionStyle.style)
  captionAnimation: CaptionAnimation.optional(), // caption entrance preset (overrides brand.captionStyle.animation)
```

In `src/config/brand.ts`:

```ts
import { CAPTION_STYLES, CAPTION_ANIMATIONS, type CaptionStyle, type CaptionAnimation } from "../render/textStyles.js";
```

Extend the frontmatter `captionStyle` object:

```ts
    captionStyle: z
      .object({
        fontSize: z.number().optional(),
        strokeWidth: z.number().optional(),
        background: CaptionStyleBg.optional(),
        style: z.enum(CAPTION_STYLES).optional(),
        animation: z.enum(CAPTION_ANIMATIONS).optional(),
      })
      .optional(),
```

Extend the resolved `Brand` interface:

```ts
  captionStyle: {
    fontSize: number;
    strokeWidth: number;
    background?: z.infer<typeof CaptionStyleBg>;
    style?: CaptionStyle;
    animation?: CaptionAnimation;
  };
```

(`mergeBrand` already deep-merges `captionStyle` — no change.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/spec.test.ts tests/brand.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck

- [ ] **Step 5: Commit**

```bash
git add src/spec/schema.ts src/config/brand.ts tests/spec.test.ts tests/brand.test.ts
git commit -m "feat(spec): captionStyle/captionAnimation + texts overlays in spec and brand schemas"
```

---

### Task 3: Resolution wiring (`props.ts` + `build.ts`)

**Files:**
- Modify: `src/render/props.ts`
- Modify: `src/commands/build.ts:217-258` (the `renderSegments` map)

**Interfaces:**
- Consumes: `resolveCaptionLook`, `resolveTexts`, types from `../render/textStyles.js` (Task 1); new `Spec`/`Brand` fields (Task 2).
- Produces: `KinoSegment` gains `captionStyle?: CaptionStyle`, `captionAnimation?: CaptionAnimation`, `texts?: ResolvedText[]` — Tasks 4–5 read exactly these names.

- [ ] **Step 1: Extend `props.ts`**

```ts
import type { CaptionStyle, CaptionAnimation, ResolvedText } from "./textStyles.js";
```

Add to `KinoSegment` (after `emphasis`):

```ts
  captionStyle?: CaptionStyle; // resolved look preset (segment ?? spec ?? brand; undefined = "stroke")
  captionAnimation?: CaptionAnimation; // resolved entrance preset (undefined = the surface's native entrance)
  texts?: ResolvedText[]; // standalone stylised text overlays, absolute-timed
```

- [ ] **Step 2: Wire resolution in `build.ts`**

Add import:

```ts
import { resolveCaptionLook, resolveTexts } from "../render/textStyles.js";
```

In the `renderSegments` map, hoist the times and add the three fields to `base`:

```ts
  const renderSegments = spec.segments.map((seg, i) => {
    const captionMode = (seg.captionMode ?? brand.captionMode ?? "phrase") as "phrase" | "words";
    const startSec = vo.timings[i].startSec;
    // hold visuals to the next beat's start so nothing blinks off during the inter-beat VO gap
    const endSec = i + 1 < spec.segments.length ? vo.timings[i + 1].startSec : vo.timings[i].endSec;
    const look = resolveCaptionLook(seg, spec, brand.captionStyle);
    const base = {
      kind: seg.kind,
      asset: seg.kind === "app" ? seg.asset : undefined,
      caption: seg.caption ?? "",
      startSec,
      endSec,
      captionMode,
      words: captionMode === "words" ? vo.words[i] : undefined,
      emphasis: captionMode === "words" ? seg.emphasis : undefined,
      captionKeyframes: seg.captionKeyframes,
      captionStyle: look.style,
      captionAnimation: look.animation,
      texts: resolveTexts(seg.texts, startSec, endSec, brand.captionStyle.fontSize, look),
    };
```

(The old inline `startSec`/`endSec` expressions in `base` are replaced by the hoisted consts; nothing else in the map changes.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run tests/textstyles.test.ts tests/spec.test.ts tests/brand.test.ts`
Expected: clean typecheck, tests PASS (resolution logic itself was unit-tested in Task 1; this task is glue)

- [ ] **Step 4: Commit**

```bash
git add src/render/props.ts src/commands/build.ts
git commit -m "feat(build): resolve caption look + text overlays onto render segments"
```

---

### Task 4: Caption components adopt presets

**Files:**
- Modify: `src/render/remotion/components.tsx` (`Caption`, `HeroCaption`, `WordCaption`; delete `plateStyle`)
- Modify: `src/render/remotion/KinoVideo.tsx:109-130` (pass the new segment fields)

**Interfaces:**
- Consumes: `wordStyle`, `lineBoxStyle`, `animatePreset`, `composeFilters`, types from `../textStyles.js`; `KinoSegment.captionStyle/captionAnimation` (Task 3).
- Produces: `Caption`/`WordCaption` gain optional props `styleName?: CaptionStyle; anim?: CaptionAnimation` (native entrance `pop`); `HeroCaption` the same (native `rise`). Undefined or native `anim` ⇒ exact legacy math.

- [ ] **Step 1: Rewrite the three components**

In `components.tsx`, add imports:

```ts
import { wordStyle, lineBoxStyle, animatePreset, composeFilters, type CaptionStyle, type CaptionAnimation } from "../textStyles";
```

(Note: this directory's files import siblings without extension via esbuild/tsx — match the file's existing import style, e.g. `"../captions"`.)

Delete `plateStyle` (absorbed by `lineBoxStyle`). Replace `Caption`:

```tsx
export const Caption: React.FC<{ text: string; t: Theme; backplate?: { bg: string } | null; styleName?: CaptionStyle; anim?: CaptionAnimation }> = ({
  text,
  t,
  backplate,
  styleName = "stroke",
  anim,
}) => {
  const f = useCurrentFrame();
  // Entrance spring 0→1; damping 14 / mass 0.6 = a soft pop with a touch of overshoot. Native
  // entrance (pop) keeps the exact legacy math; other presets come from animatePreset.
  const s = spring({ frame: f, fps: 30, config: { damping: 14, mass: 0.6 } });
  const a =
    !anim || anim === "pop"
      ? { transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`, opacity: 1, filter: undefined as string | undefined }
      : animatePreset(anim, { s, frame: f, index: 0 });
  const ink = wordStyle(styleName, t, { shadow: "0 6px 20px rgba(0,0,0,.45)" });
  return (
    <div style={{ position: "absolute", left: 48, right: 48, bottom: CAPTION_BOTTOM, display: "flex", justifyContent: "center" }}>
      <span
        style={{
          fontFamily: t.font,
          fontSize: t.captionFontSize,
          textAlign: "center",
          lineHeight: 1.04,
          whiteSpace: "pre-line",
          ...ink,
          ...lineBoxStyle(styleName, t, backplate?.bg),
          transform: a.transform,
          opacity: a.opacity,
          filter: composeFilters(ink.filter as string | undefined, a.filter),
        }}
      >
        {text}
      </span>
    </div>
  );
};
```

Replace `HeroCaption`:

```tsx
// Faceless talking beats: the text IS the visual. Big, centered, word-by-word cascade (native
// entrance: rise) so the frame is full and alive instead of a small lower-third line.
export const HeroCaption: React.FC<{ text: string; t: Theme; styleName?: CaptionStyle; anim?: CaptionAnimation }> = ({
  text,
  t,
  styleName = "stroke",
  anim,
}) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: 22, rowGap: 6, ...lineBoxStyle(styleName, t, null) }}>
        {words.map((w, i) => {
          // `i * 3` = 3-frame stagger per word (left→right cascade). Spring damping 13 / mass 0.7.
          // 1.42 scales the hero font 42% above the lower-third caption size.
          const s = spring({ frame: f - i * 3, fps: 30, config: { damping: 13, mass: 0.7 } });
          const a =
            !anim || anim === "rise"
              ? { transform: `translateY(${interpolate(s, [0, 1], [44, 0])}px)`, opacity: interpolate(s, [0, 1], [0, 1]), filter: undefined as string | undefined }
              : animatePreset(anim, { s, frame: f - i * 3, index: i });
          const ink = wordStyle(styleName, t, { shadow: "0 8px 28px rgba(0,0,0,.5)" });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: t.font,
                fontSize: Math.round(t.captionFontSize * 1.42),
                lineHeight: 1.06,
                ...ink,
                transform: a.transform,
                opacity: a.opacity,
                filter: composeFilters(ink.filter as string | undefined, a.filter),
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
```

Replace `WordCaption`'s row/word body (props gain `styleName = "stroke"`, `anim`):

```tsx
export const WordCaption: React.FC<{
  words: WordTiming[];
  emphasis?: string[];
  startSec: number;
  t: Theme;
  backplate?: { bg: string } | null;
  styleName?: CaptionStyle;
  anim?: CaptionAnimation;
}> = ({ words, emphasis = [], startSec, t, backplate, styleName = "stroke", anim }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tAbs = startSec + frame / fps;
  const active = activeWordIndex(words, tAbs);
  const emph = new Set(emphasis.map(normWord));
  const row = (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: 18,
        rowGap: 4,
        maxWidth: "100%",
        // words mode never takes the whole-line highlight box (words box individually) — only the
        // legacy backplate applies here.
        ...lineBoxStyle("stroke", t, backplate?.bg),
      }}
    >
      {words.map((w, i) => {
        // revealFrame = frames since this word started (negative until it's spoken). Spring damping
        // 12 / mass 0.6 = a brisk per-word pop.
        const revealFrame = (tAbs - w.start) * fps;
        const s = spring({ frame: revealFrame, fps, config: { damping: 12, mass: 0.6 } });
        const isActive = i === active;
        const isEmph = emph.has(normWord(w.word));
        // Single accent: the spoken word and the brand name take the style's highlight treatment.
        const isHi = isHighlightWord(w.word, { isActive, brandName: t.brandName });
        // Emphasised active words shake ±3px; 1.4 = rad/frame oscillation (~7 wobbles/sec at 30fps).
        const shake = isActive && isEmph ? Math.sin(frame * 1.4) * 3 : 0;
        const ink = wordStyle(styleName, t, { highlight: isHi, emph: isActive && isEmph });
        let transform: string;
        let opacity: number;
        let filter: string | undefined;
        if (!anim || anim === "pop") {
          // Native pop — exact legacy math: 0.6→1 grow-in, active word bumped 1.1x, unspoken hidden.
          const scale = (revealFrame <= 0 ? 0.6 : interpolate(s, [0, 1], [0.6, 1])) * (isActive ? 1.1 : 1);
          transform = `translateX(${shake}px) scale(${scale})`;
          opacity = revealFrame <= 0 ? 0 : interpolate(s, [0, 1], [0, 1]);
          filter = composeFilters(ink.filter as string | undefined);
        } else {
          const a = animatePreset(anim, { s, frame: revealFrame, index: i });
          transform = `translateX(${shake}px) ${a.transform} scale(${isActive ? 1.1 : 1})`;
          opacity = a.opacity;
          filter = composeFilters(ink.filter as string | undefined, a.filter);
        }
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              fontFamily: t.font,
              fontSize: Math.round(t.captionFontSize * 0.92),
              lineHeight: 1.05,
              ...ink,
              transform,
              opacity,
              filter,
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
  return (
    <div style={{ position: "absolute", left: 56, right: 56, bottom: CAPTION_BOTTOM, display: "flex", justifyContent: "center" }}>{row}</div>
  );
};
```

**Legacy-exactness check while editing:** with `styleName`/`anim` unset, every emitted style value must match the pre-change code (`stroke` ink incl. `WebkitTextStroke`/`paintOrder`/shadows; pop/rise math; backplate box). The only inert diffs allowed: `filter: undefined` where none existed, and CSS property order.

- [ ] **Step 2: Thread segment fields in `KinoVideo.tsx`**

In the captions map (lines ~117-127), pass the new props:

```tsx
              {wordMode ? (
                <WordCaption words={s.words!} emphasis={s.emphasis} startSec={s.startSec} t={theme} backplate={backplate} styleName={s.captionStyle} anim={s.captionAnimation} />
              ) : hero ? (
                <HeroCaption text={s.caption} t={theme} styleName={s.captionStyle} anim={s.captionAnimation} />
              ) : (
                <Caption text={s.caption} t={theme} backplate={backplate} styleName={s.captionStyle} anim={s.captionAnimation} />
              )}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run tests/render-mock.test.ts tests/caption-backplate.test.ts`
Expected: clean typecheck; all render-mock cases PASS (default path — components render with the new code, legacy look)

- [ ] **Step 4: Commit**

```bash
git add src/render/remotion/components.tsx src/render/remotion/KinoVideo.tsx
git commit -m "feat(render): caption components consume style/animation presets"
```

---

### Task 5: `TextOverlay` component + layer wiring

**Files:**
- Modify: `src/render/remotion/components.tsx` (add `TextOverlay`)
- Modify: `src/render/remotion/KinoVideo.tsx` (render `segments[].texts`; update the layer-stack header comment)
- Test: `tests/render-mock.test.ts` (one stylised smoke case)

**Interfaces:**
- Consumes: `KinoSegment.texts` (`ResolvedText[]`, Task 3); presets (Task 1).
- Produces: `TextOverlay: React.FC<{ o: ResolvedText; t: Theme }>`.

- [ ] **Step 1: Write the failing test**

Append to `tests/render-mock.test.ts`:

```ts
  it("renders stylised captions and standalone text overlays", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-rstyle-"));
    const props: KinoProps = {
      theme,
      fps: 30,
      avatar: null,
      avatarWindows: [],
      voTrack: null,
      logo: null,
      background: { kind: "glow", image: null, customCode: null, params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 }, keyframes: [], triggers: [] },
      disclosure: "test",
      segments: [
        {
          kind: "avatar",
          caption: "hi",
          startSec: 0,
          endSec: 2,
          captionMode: "words",
          words: [{ word: "hello", start: 0, end: 0.6 }, { word: "world", start: 0.7, end: 1.4 }],
          emphasis: ["world"],
          captionStyle: "highlight",
          captionAnimation: "wave",
          texts: [{ text: "3× faster", fromSec: 0.2, durSec: 1.5, x: 50, y: 16, sizePx: 111, style: "gradient", animation: "blur-in" }],
        },
      ],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "style" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/render-mock.test.ts -t "stylised"`
Expected: FAIL — the overlay isn't rendered yet, but the *type* already exists, so this fails only if the render crashes… it won't. So treat the failing signal as: `tsc` passes but no overlay layer exists. Proceed — this case exists to smoke the non-default path end-to-end once wired.

- [ ] **Step 3: Add `TextOverlay` to `components.tsx`**

```tsx
// Standalone stylised text overlay (spec `texts[]`): a one-line headline at a named slot, using
// the same style/animation presets as captions. Anchored at its centre like AnimatedElement.
export const TextOverlay: React.FC<{ o: ResolvedText; t: Theme }> = ({ o, t }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14, mass: 0.6 } });
  const a = animatePreset(o.animation, { s, frame: f, index: 0 });
  const ink = wordStyle(o.style, t, {});
  return (
    <div style={{ position: "absolute", left: `${o.x}%`, top: `${o.y}%`, transform: "translate(-50%, -50%)", display: "flex", justifyContent: "center" }}>
      <span
        style={{
          fontFamily: t.font,
          fontSize: o.sizePx,
          textAlign: "center",
          lineHeight: 1.05,
          whiteSpace: "pre-line",
          ...ink,
          ...lineBoxStyle(o.style, t, null),
          transform: a.transform,
          opacity: a.opacity,
          filter: composeFilters(ink.filter as string | undefined, a.filter),
        }}
      >
        {o.text}
      </span>
    </div>
  );
};
```

Add `ResolvedText` to the type import from `../textStyles`.

- [ ] **Step 4: Wire into `KinoVideo.tsx`**

Import `TextOverlay` alongside the other components. Insert between the motion-graphic-overlays block and the logo block:

```tsx
      {/* Standalone stylised text overlays (spec `texts[]`) — above motion overlays, below captions. */}
      {segments.flatMap((s, i) =>
        (s.texts ?? []).map((o, j) => (
          <Sequence key={`tx${i}-${j}`} from={f(o.fromSec)} durationInFrames={Math.max(1, f(o.durSec))}>
            <TextOverlay o={o} t={theme} />
          </Sequence>
        )),
      )}
```

Update the layer-stack comment at the top of the file (insert "standalone text overlays" between motion-graphic overlays and logo, renumber).

- [ ] **Step 5: Run tests**

Run: `npx tsc --noEmit && npx vitest run tests/render-mock.test.ts`
Expected: PASS (including the new stylised case)

- [ ] **Step 6: Commit**

```bash
git add src/render/remotion/components.tsx src/render/remotion/KinoVideo.tsx tests/render-mock.test.ts
git commit -m "feat(render): TextOverlay component renders spec texts[] overlays"
```

---

### Task 6: Docs sync + full verification

**Files:**
- Modify: `docs/spec-reference.md`
- Modify: `skills/video-production/reference.md`, `skills/video-production/SKILL.md` (wherever captions/spec fields are documented — grep first)
- Modify: `docs/superpowers/specs/2026-07-18-stylised-text-design.md` (one correction)

- [ ] **Step 1: Update `docs/spec-reference.md`**

- **Top-level fields** table: add rows
  - `captionStyle` · `stroke\|highlight\|gradient\|minimal` · `stroke` · Caption look preset; see [Captions](#captions).
  - `captionAnimation` · `pop\|rise\|typewriter\|wave\|blur-in\|none` · surface native · Caption entrance preset; unset = pop (rise for faceless hero text).
- **Each segment table** (`avatar`, `app`, `motion`): add `captionStyle`, `captionAnimation`, and `texts` rows (`texts` = array of `{ text, at, dur?, position?, size?, style?, animation? }`, `at` seconds from segment start).
- **Captions** section: document the four styles (table from the spec doc's "Look mapping"), the six animations, layering (`segment ?? spec ?? brand`), and that words-mode reveal timing stays VO-driven.
- Add a short **Text overlays** section after Captions: slot positions (`top/center/bottom/left/right`), sizes (`small/medium/big` = 0.7/1/1.5 × caption font size), clamping to the segment, style/animation defaulting to the segment's caption look.
- **brand.md** table: extend the `captionStyle` row to `{ fontSize?, strokeWidth?, background?, style?, animation? }`.

- [ ] **Step 2: Update the video-production skill docs**

Run: `grep -n "captionMode\|caption" skills/video-production/SKILL.md skills/video-production/reference.md`
Add the new fields wherever the spec surface is described (mirror the spec-reference wording, keep it terse — these are agent-facing docs).

- [ ] **Step 3: Correct the design doc**

In `docs/superpowers/specs/2026-07-18-stylised-text-design.md`, change the `captionAnimation` default from `"pop"` to: *unset = the surface's native entrance (pop; rise for hero text)* — matching the implemented regression-safe behaviour.

- [ ] **Step 4: Full verification**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, full suite PASS.

Visual spot-check (mock, no API spend) — from a scratch project or an existing example spec with `captionStyle: "highlight"`, `captionAnimation: "wave"`, and one `texts` overlay added:

```bash
node bin/kino.mjs still <spec.json> --mock --at 1.0
```

Open the PNG: boxed active word, night line plate, gradient overlay headline visible.

- [ ] **Step 5: Commit**

```bash
git add docs/spec-reference.md skills/video-production docs/superpowers/specs/2026-07-18-stylised-text-design.md
git commit -m "docs: stylised text — spec reference, skill docs, design-doc default correction"
```

---

## Self-Review (done at authoring time)

- **Spec coverage:** styles ✓ (T1 presets, T4 consumption) · animations ✓ (T1, T4) · overlays ✓ (T1 resolver, T2 schema, T3 wiring, T5 component) · brand/spec/segment layering ✓ (T1, T2, T3) · docs sync ✓ (T6) · regression gate ✓ (native-entrance rule, T4 check + render-mock suite).
- **Deviation from spec doc (deliberate):** animation default is *surface-native* (undefined), not a global `"pop"` — a global pop default would change faceless hero beats and break the pixel-identical gate. T6 Step 3 records this in the design doc.
- **Type consistency:** `styleName`/`anim` prop names uniform across the three caption components; `resolveCaptionLook` returns `animation?: CaptionAnimation` and every consumer (`build.ts`, components, `resolveTexts` fallback) handles `undefined`.
