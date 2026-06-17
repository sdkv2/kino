# Markdown brands (optional) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the required `brands/<name>/brand.json` with an optional `brands/<name>/brand.md` (YAML frontmatter merged over kino defaults + a free-form guidelines body), make `kino build` work with no brand at all, relax voice/look validation, and add a `kino brand` command.

**Architecture:** A `DEFAULT_BRAND` constant holds kino's house values. `loadBrand` reads `brand.md`, splits frontmatter from body, `yaml`-parses + validates the frontmatter with an all-optional schema, and deep-merges it over `DEFAULT_BRAND` → a fully-populated `Brand`, so render code is unchanged. The brand becomes optional in `prepare`; voice/look are checked lazily (voice only for real builds, look only for non-faceless). The disclosure draws nothing when empty.

**Tech Stack:** TypeScript (ESM), Zod, Vitest, Remotion, the `yaml` package (new).

**Spec:** [`docs/superpowers/specs/2026-06-17-markdown-brands-design.md`](../specs/2026-06-17-markdown-brands-design.md)

---

## File Structure

- `src/config/brand.ts` — **rewrite**: `DEFAULT_BRAND`, `BrandFrontmatterSchema` (all-optional), `parseBrandMd`, `mergeBrand`, `loadBrand` (reads `brand.md`), `loadBrandDoc` (brand + guidelines body). `Brand` type unchanged (complete shape).
- `src/spec/validate.ts` — **modify**: `resolveVoice` no longer throws; `validateSpec` drops the unconditional `resolveVoiceLook` call.
- `src/commands/build.ts` — **modify**: optional brand (default `DEFAULT_BRAND`); lazy voice check after provider/mock are known.
- `src/render/remotion/KinoVideo.tsx` — **modify**: render the disclosure only when non-empty.
- `src/commands/brand.ts` — **create**: `kino brand [name]` (list / print frontmatter + guidelines).
- `src/cli.ts` — **modify**: register `kino brand`.
- `src/commands/init.ts` — **modify**: scaffold `brand.md` instead of `brand.json`.
- `skills/video-production/SKILL.md`, `README.md` — **modify**: markdown brands + `kino brand`.
- `package.json` — **modify**: add `yaml`.
- Tests: `tests/brand.test.ts` (new), `tests/validate.test.ts` (extend or new), `tests/render-motion.test.ts` (empty-disclosure render).

---

## Task 1: brand.md loader + defaults

**Files:**
- Modify: `package.json` (add `yaml`)
- Modify: `src/config/brand.ts`
- Test: `tests/brand.test.ts`

- [ ] **Step 1: Add the `yaml` dependency**

Run:
```bash
npm install yaml@^2.5.0
```
Expected: `package.json` `dependencies` gains `"yaml"`; install succeeds.

- [ ] **Step 2: Write the failing loader tests**

Create `tests/brand.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrand, loadBrandDoc, DEFAULT_BRAND, parseBrandMd } from "../src/config/brand.js";

function brandDirWith(md: string) {
  const root = mkdtempSync(join(tmpdir(), "kino-brand-"));
  const dir = join(root, "brands", "acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "brand.md"), md);
  return dir;
}

describe("parseBrandMd", () => {
  it("splits YAML frontmatter from the body", () => {
    const { frontmatter, body } = parseBrandMd("---\nname: acme\n---\n# Guide\n- be bold\n");
    expect(frontmatter).toEqual({ name: "acme" });
    expect(body.trim()).toBe("# Guide\n- be bold".trim());
  });
  it("treats a body-only file as all-body, empty frontmatter", () => {
    const { frontmatter, body } = parseBrandMd("# Just guidelines\n- tone: calm\n");
    expect(frontmatter).toEqual({});
    expect(body).toContain("Just guidelines");
  });
});

describe("loadBrand", () => {
  it("merges partial frontmatter over DEFAULT_BRAND", () => {
    const dir = brandDirWith("---\nname: acme\ncolors: { night: \"#101010\" }\nfont: Sora\ndefaultVoice: v123\n---\nguide\n");
    const b = loadBrand(dir);
    expect(b.name).toBe("acme");
    expect(b.colors.night).toBe("#101010");          // overridden
    expect(b.colors.mint).toBe(DEFAULT_BRAND.colors.mint); // defaulted
    expect(b.font).toBe("Sora");
    expect(b.defaultVoice).toBe("v123");
    expect(b.disclosure).toBe("");                   // no default disclosure
    expect(b.captionStyle.fontSize).toBe(74);        // defaulted
  });
  it("a frontmatter-less brand.md resolves to all defaults", () => {
    const dir = brandDirWith("# acme guidelines\n- calm, plain-spoken\n");
    const b = loadBrand(dir);
    expect(b.colors).toEqual(DEFAULT_BRAND.colors);
    expect(b.disclosure).toBe("");
  });
  it("throws a clear error when brand.md is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "kino-nobrand-"));
    expect(() => loadBrand(join(root, "brands", "ghost"))).toThrow(/brand\.md/);
  });
  it("rejects a malformed frontmatter type", () => {
    const dir = brandDirWith("---\ncaptionMode: sideways\n---\n");
    expect(() => loadBrand(dir)).toThrow();
  });
});

describe("loadBrandDoc", () => {
  it("returns the resolved brand + the guidelines body", () => {
    const dir = brandDirWith("---\nname: acme\n---\n# Guide\n- punchy\n");
    const { brand, body } = loadBrandDoc(dir);
    expect(brand.name).toBe("acme");
    expect(body).toContain("punchy");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/brand.test.ts`
Expected: FAIL — `loadBrandDoc`/`DEFAULT_BRAND`/`parseBrandMd` not exported; `loadBrand` still expects `brand.json`.

- [ ] **Step 4: Rewrite `src/config/brand.ts`**

Replace the entire file with:
```ts
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

// The complete, resolved brand shape the render pipeline consumes (always fully populated after merge).
const Provider = z.enum(["none", "heygen", "hedra", "replicate"]);
const LogoSize = z.union([z.enum(["small", "medium", "big"]), z.number()]);
const LogoPosition = z.union([z.enum(["top", "bottom", "left", "right", "center"]), z.object({ x: z.number(), y: z.number() })]);
const Background = z.enum(["glow", "image", "mesh", "aurora", "particles", "grid", "custom"]);
const CaptionStyleBg = z.object({ color: z.string().optional(), opacity: z.number().min(0).max(1).optional(), appOnly: z.boolean().optional() });

// Frontmatter: every field optional (defaults come from DEFAULT_BRAND). Types are still validated.
export const BrandFrontmatterSchema = z.object({
  name: z.string().optional(),
  colors: z.object({
    night: z.string().optional(), mint: z.string().optional(), green: z.string().optional(),
    white: z.string().optional(), gold: z.string().optional(),
  }).optional(),
  font: z.string().optional(),
  labelFont: z.string().optional(),
  captionStyle: z.object({
    fontSize: z.number().optional(), strokeWidth: z.number().optional(), background: CaptionStyleBg.optional(),
  }).optional(),
  disclosure: z.string().optional(),
  facelessDisclosure: z.string().optional(),
  logo: z.string().optional(),
  logoSize: LogoSize.optional(),
  logoPosition: LogoPosition.optional(),
  facelessBackdrop: z.string().optional(),
  background: Background.optional(),
  backgroundComponent: z.string().optional(),
  backgroundColors: z.array(z.string()).optional(),
  backgroundIntensity: z.number().optional(),
  captionMode: z.enum(["phrase", "words"]).optional(),
  bannedPhrases: z.array(z.string()).optional(),
  defaultVoice: z.string().optional(),
  defaultLook: z.string().optional(),
  defaultProvider: Provider.optional(),
  avatarImage: z.string().optional(),
  hedraModelId: z.string().optional(),
  replicateModel: z.string().optional(),
  replicateImageField: z.string().optional(),
  replicateAudioField: z.string().optional(),
  replicateInput: z.record(z.unknown()).optional(),
  voiceAliases: z.record(z.string()).optional(),
  lookAliases: z.record(z.string()).optional(),
}).strict();

export type BrandFrontmatter = z.infer<typeof BrandFrontmatterSchema>;

export interface Brand {
  name: string;
  colors: { night: string; mint: string; green: string; white: string; gold: string };
  font: string;
  labelFont?: string;
  captionStyle: { fontSize: number; strokeWidth: number; background?: z.infer<typeof CaptionStyleBg> };
  disclosure: string;
  facelessDisclosure?: string;
  logo?: string;
  logoSize?: z.infer<typeof LogoSize>;
  logoPosition?: z.infer<typeof LogoPosition>;
  facelessBackdrop?: string;
  background?: z.infer<typeof Background>;
  backgroundComponent?: string;
  backgroundColors?: string[];
  backgroundIntensity?: number;
  captionMode?: "phrase" | "words";
  bannedPhrases: string[];
  defaultVoice?: string;
  defaultLook?: string;
  defaultProvider?: z.infer<typeof Provider>;
  avatarImage?: string;
  hedraModelId?: string;
  replicateModel?: string;
  replicateImageField?: string;
  replicateAudioField?: string;
  replicateInput?: Record<string, unknown>;
  voiceAliases: Record<string, string>;
  lookAliases: Record<string, string>;
}

// kino house defaults — used when no brand is set and to fill any field a brand.md omits.
export const DEFAULT_BRAND: Brand = {
  name: "",
  colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", white: "#ffffff", gold: "#d99a20" },
  font: 'Helvetica, "Helvetica Neue", Arial, sans-serif',
  captionStyle: { fontSize: 74, strokeWidth: 9 },
  disclosure: "", // none unless a brand/spec sets it
  bannedPhrases: [],
  voiceAliases: {},
  lookAliases: {},
};

// Split a brand.md into its YAML frontmatter (object) + the markdown body (guidelines).
export function parseBrandMd(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { frontmatter: {}, body: text };
  const fm = (parseYaml(m[1]) ?? {}) as Record<string, unknown>;
  return { frontmatter: fm, body: m[2] };
}

function mergeBrand(base: Brand, fm: BrandFrontmatter): Brand {
  return {
    ...base,
    ...fm,
    colors: { ...base.colors, ...(fm.colors ?? {}) },
    captionStyle: { ...base.captionStyle, ...(fm.captionStyle ?? {}) },
  } as Brand;
}

// Read brands/<name>/brand.md → resolved Brand (frontmatter merged over DEFAULT_BRAND).
export function loadBrand(brandDir: string): Brand {
  return loadBrandDoc(brandDir).brand;
}

// Like loadBrand, but also returns the markdown guidelines body (for `kino brand`).
export function loadBrandDoc(brandDir: string): { brand: Brand; body: string } {
  const mdPath = join(brandDir, "brand.md");
  if (!existsSync(mdPath)) throw new Error(`Brand not found: ${mdPath} (brands are markdown now — create a brand.md)`);
  const { frontmatter, body } = parseBrandMd(readFileSync(mdPath, "utf8"));
  const fm = BrandFrontmatterSchema.parse(frontmatter);
  return { brand: mergeBrand(DEFAULT_BRAND, fm), body };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/brand.test.ts`
Expected: PASS (all parse/merge/default/missing/malformed/doc cases).

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: `tsc` errors in `build.ts`/`validate.ts`/`init.ts` are expected here only if they reference removed exports — they don't (the `Brand` type is unchanged and `loadBrand(brandDir)` keeps its signature). `tsc` should pass. If it flags anything, it's addressed in later tasks; proceed.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config/brand.ts tests/brand.test.ts
git commit -m "feat(brand): load brands from brand.md (frontmatter + guidelines) with DEFAULT_BRAND"
```

---

## Task 2: Optional brand + lazy voice/look validation

**Files:**
- Modify: `src/spec/validate.ts`
- Modify: `src/commands/build.ts`
- Test: `tests/brand.test.ts` (append)

- [ ] **Step 1: Write the failing validation tests**

Append to `tests/brand.test.ts`:
```ts
import { resolveVoice, validateSpec } from "../src/spec/validate.js";
import { DEFAULT_BRAND as DB } from "../src/config/brand.js";
import type { Spec } from "../src/spec/schema.js";

describe("resolveVoice (lazy)", () => {
  it("returns '' when no voice is set anywhere (no throw)", () => {
    expect(resolveVoice({} as Spec, DB)).toBe("");
  });
  it("resolves spec.voice through aliases", () => {
    expect(resolveVoice({ voice: "will" } as Spec, { ...DB, voiceAliases: { will: "v9" } })).toBe("v9");
  });
});

describe("validateSpec (no eager look requirement)", () => {
  it("does not throw for a faceless spec with no voice/look", () => {
    const spec = { segments: [{ kind: "motion", source: "m.js", text: "hi" }] } as unknown as Spec;
    const project = { assetPath: (r: string) => "/nope/" + r } as any;
    // motion/app asset checks would throw on missing files, so use an avatar (no asset) beat:
    const spec2 = { segments: [{ kind: "avatar", text: "hi", caption: "c" }] } as unknown as Spec;
    expect(() => validateSpec(spec2, DB, project)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/brand.test.ts -t "lazy"`
Expected: FAIL — `resolveVoice` throws on no voice; `validateSpec` throws "No avatar look".

- [ ] **Step 3: Relax `validate.ts`**

In `src/spec/validate.ts`, replace `resolveVoice` (lines 28–32) with a non-throwing version:
```ts
export function resolveVoice(spec: Spec, brand: Brand): string {
  const alias = spec.voice ?? brand.defaultVoice;
  return alias ? (brand.voiceAliases[alias] ?? alias) : "";
}
```

In `validateSpec` (lines 69–77), delete the line `  resolveVoiceLook(spec, brand);` (the eager look check). The function becomes:
```ts
export function validateSpec(spec: Spec, brand: Brand, project: Project): void {
  const hits = complianceScan(spec, brand);
  if (hits.length) {
    throw new Error("Compliance: banned phrases found — " + hits.map((h) => `"${h.phrase}" @ ${h.where}`).join("; "));
  }
  assertAssetsExist(spec, project);
  assertMotionGraphics(spec, project);
}
```
(`resolveVoiceLook` stays exported — it's still used for `heygen` in `build.ts`, where a missing look correctly throws.)

- [ ] **Step 4: Make the brand optional + add the lazy voice check in `build.ts`**

In `src/commands/build.ts` `prepare` (lines ~83–98), replace:
```ts
  const pc = project.projectConfigPath ? loadProjectConfig(project.projectConfigPath) : undefined;
  const brandName = spec.brand ?? pc?.brand;
  if (!brandName) throw new Error("No brand: set spec.brand or a brand in the project's project.json");
  const rawBrand = loadBrand(project.brandDir(brandName));
```
with:
```ts
  const pc = project.projectConfigPath ? loadProjectConfig(project.projectConfigPath) : undefined;
  const brandName = spec.brand ?? pc?.brand;
  const rawBrand = brandName ? loadBrand(project.brandDir(brandName)) : DEFAULT_BRAND;
```

Add `DEFAULT_BRAND` to the brand import at the top of `build.ts` (line 7):
```ts
import { loadBrand, DEFAULT_BRAND, type Brand } from "../config/brand.js";
```

After `const voiceId = resolveVoice(spec, brand);` (line 97) add the lazy real-build voice check:
```ts
  if (!mock && !voiceId) {
    throw new Error("No voice for a real build — set spec.voice or the brand's defaultVoice (or use --mock).");
  }
```
(`mock` is defined just below at line 100 as `const mock = !!opts.mock;` — **move that line up** to before this check, i.e. set `const mock = !!opts.mock;` right after `const formats = ...` on line 98 so it's available.)

- [ ] **Step 5: Run the validation tests + typecheck**

Run: `npx vitest run tests/brand.test.ts`
Expected: PASS.
Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/spec/validate.ts src/commands/build.ts tests/brand.test.ts
git commit -m "feat(brand): make brand optional (DEFAULT_BRAND) + lazy voice/look validation"
```

---

## Task 3: Draw no disclosure when empty

**Files:**
- Modify: `src/render/remotion/KinoVideo.tsx`
- Test: `tests/render-motion.test.ts` (append)

- [ ] **Step 1: Write the failing render test**

Append to `tests/render-motion.test.ts`:
```ts
describe("empty disclosure", () => {
  it("renders a still with no disclosure text without crashing", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-nodisc-"));
    const props: KinoProps = {
      theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
      disclosure: "",
      segments: [{ kind: "motion", caption: "", startSec: 0, endSec: 2,
        motion: { html: `<div style="position:absolute;inset:0;background:#001"></div>`, params: {}, keyframes: [], triggers: [] } }],
    };
    const outs = await renderStills({ props, publicDir: mkdtempSync(join(tmpdir(), "nodisc-pub-")), format: "9:16", frames: [{ frame: 20, name: "nd" }], outDir });
    expect(existsSync(outs[0])).toBe(true);
  }, 180000);
});
```

- [ ] **Step 2: Run to verify it passes-but-unguarded (or fails)**

Run: `npx vitest run tests/render-motion.test.ts -t "empty disclosure"`
Expected: It renders (a still always emits a PNG even with an empty `<Disclosure text="">`). This test guards against a regression/crash; the visual "draws nothing" is enforced by Step 3.

- [ ] **Step 3: Guard the disclosure render**

In `src/render/remotion/KinoVideo.tsx` (line 122), replace:
```tsx
      <Disclosure text={disclosure} t={theme} />
```
with:
```tsx
      {disclosure ? <Disclosure text={disclosure} t={theme} /> : null}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run tests/render-motion.test.ts -t "empty disclosure"`
Expected: PASS.
Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/remotion/KinoVideo.tsx tests/render-motion.test.ts
git commit -m "feat(brand): render no disclosure when the brand provides none"
```

---

## Task 4: `kino brand [name]` command

**Files:**
- Create: `src/commands/brand.ts`
- Modify: `src/cli.ts`
- Test: `tests/brand.test.ts` (append)

- [ ] **Step 1: Write the failing command test**

Append to `tests/brand.test.ts`:
```ts
import { brandText, listBrands } from "../src/commands/brand.js";

describe("kino brand", () => {
  it("formats a brand's frontmatter summary + guidelines body", () => {
    const dir = brandDirWith("---\nname: acme\ncolors: { mint: \"#0f0\" }\ndefaultVoice: v1\n---\n# Acme\n- be punchy\n");
    const t = brandText(dir);
    expect(t).toMatch(/acme/);
    expect(t).toMatch(/#0f0/);
    expect(t).toMatch(/be punchy/);   // the guidelines body is printed
  });
  it("lists brand names that have a brand.md", () => {
    const dir = brandDirWith("---\nname: acme\n---\nx\n");          // .../brands/acme/brand.md
    const brandsRoot = join(dir, "..");                            // .../brands
    expect(listBrands(brandsRoot)).toContain("acme");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/brand.test.ts -t "kino brand"`
Expected: FAIL — module `../src/commands/brand.js` not found.

- [ ] **Step 3: Implement the command**

Create `src/commands/brand.ts`:
```ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resolveProject } from "../config/project.js";
import { loadBrandDoc } from "../config/brand.js";

// Brand names = subdirs of brands/ that contain a brand.md.
export function listBrands(brandsRoot: string): string[] {
  if (!existsSync(brandsRoot)) return [];
  return readdirSync(brandsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(brandsRoot, e.name, "brand.md")))
    .map((e) => e.name)
    .sort();
}

// Human-readable dump of a brand: resolved frontmatter values + the guidelines body.
export function brandText(brandDir: string): string {
  const { brand, body } = loadBrandDoc(brandDir);
  const lines = [
    `name: ${brand.name || "(unset)"}`,
    `colors: night ${brand.colors.night} · mint ${brand.colors.mint} · green ${brand.colors.green} · white ${brand.colors.white} · gold ${brand.colors.gold}`,
    `font: ${brand.font}`,
    `captionMode: ${brand.captionMode ?? "phrase (default)"}    background: ${brand.background ?? "glow (default)"}`,
    `voice: ${brand.defaultVoice ?? "(unset — set spec.voice)"}    disclosure: ${brand.disclosure || "(none)"}`,
    "",
    "— guidelines —",
    body.trim() || "(no guidelines body)",
    "",
  ];
  return lines.join("\n");
}

export async function brand(name?: string): Promise<void> {
  const project = resolveProject();
  const brandsRoot = join(project.workspaceRoot, "brands");
  if (!name) {
    const names = listBrands(brandsRoot);
    process.stdout.write(names.length ? `Brands:\n${names.map((n) => "  · " + n).join("\n")}\n` : "No brands found (brands are optional — kino uses defaults).\n");
    return;
  }
  process.stdout.write(brandText(project.brandDir(name)));
}
```

In `src/cli.ts`, after the `motion` command block, add:
```ts
program
  .command("brand [name]")
  .description("List brands, or print a brand's styling values + markdown guidelines")
  .action(async (name) => (await import("./commands/brand.js")).brand(name));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/brand.test.ts -t "kino brand"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/brand.ts src/cli.ts tests/brand.test.ts
git commit -m "feat(brand): add `kino brand` (list + print frontmatter & guidelines)"
```

---

## Task 5: `kino init` scaffolds brand.md

**Files:**
- Modify: `src/commands/init.ts`
- Test: `tests/brand.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/brand.test.ts`:
```ts
import { init } from "../src/commands/init.js";
import { readFileSync as rfs, existsSync as exists } from "node:fs";

describe("kino init scaffolds brand.md", () => {
  it("writes a brand.md (frontmatter + guidelines) and loads cleanly", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kino-init-"));
    const prev = process.cwd();
    process.chdir(cwd);
    try {
      await init("acme");
      const md = join(cwd, "brands", "acme", "brand.md");
      expect(exists(md)).toBe(true);
      expect(rfs(md, "utf8")).toMatch(/^---/);
      expect(loadBrand(join(cwd, "brands", "acme")).name).toBe("acme");
    } finally {
      process.chdir(prev);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/brand.test.ts -t "scaffolds brand.md"`
Expected: FAIL — init still writes `brand.json`, so `brand.md` doesn't exist.

- [ ] **Step 3: Update `init.ts`**

In `src/commands/init.ts`, replace the brand-file block (lines 13–32) with:
```ts
  const bf = join(p.brandDir(brand), "brand.md");
  if (!existsSync(bf)) {
    writeFileSync(
      bf,
      [
        "---",
        `name: ${brand}`,
        'colors: { night: "#0b1020", mint: "#80e2b4", green: "#0c8d64" }',
        "# disclosure: AI-generated   # optional — shown on every video when set",
        "# defaultVoice: <elevenlabs-voice-id>   # or set per spec",
        "bannedPhrases: [get the job, guaranteed interview, land more interviews]",
        "---",
        `# ${brand} — brand guidelines`,
        "",
        "- Voice: (describe tone — e.g. confident, plain-spoken, short sentences)",
        "- Look: (palette usage, gradients, what to avoid)",
        "- Captions: (phrase vs word-by-word; what to emphasise)",
        "",
        "_All frontmatter is optional; anything omitted uses kino defaults._",
        "",
      ].join("\n"),
    );
  }
```
Update the final log line:
```ts
  log.ok(`Initialised brand '${brand}'. Fill .env and brands/${brand}/brand.md, then add assets/specs.`);
```

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run tests/brand.test.ts -t "scaffolds brand.md"`
Expected: PASS.
Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts tests/brand.test.ts
git commit -m "feat(brand): kino init scaffolds brand.md instead of brand.json"
```

---

## Task 6: Docs + full verification

**Files:**
- Modify: `skills/video-production/SKILL.md`
- Modify: `README.md`

- [ ] **Step 1: Update SKILL.md**

In `skills/video-production/SKILL.md`, change the workflow/brand mentions to reflect markdown brands. Under "Workflow" step 1, after the `kino fonts` parenthetical, add:
```markdown
   Brands are **optional markdown** — `brands/<name>/brand.md` (YAML frontmatter for palette/font/voice/
   disclosure + a free-form guidelines body). Run `kino brand <name>` to read a brand's styling rules;
   with no brand, kino uses its defaults. (Set the brand via `spec.brand` or a project's `project.json`.)
```
In the "Hard rules" section, change the AI-disclosure bullet to:
```markdown
- **AI disclosure** is added automatically from the brand when the brand sets one (`disclosure` /
  `facelessDisclosure`); with no brand or no disclosure set, none is shown.
```

- [ ] **Step 2: Update README.md**

In `README.md`, update any `brand.json` reference to `brand.md` and note brands are optional. In the "Use" section, change the comment `# ...fill brand.json (voiceAliases/lookAliases), ...` to:
```markdown
# ...fill brands/<brand>/brand.md (optional frontmatter + guidelines), add assets/, write specs/
```
Add to the feature list (near "Projects"):
```markdown
- **Brands (optional, markdown)** — `brands/<name>/brand.md`: YAML frontmatter (palette/font/voice/
  disclosure — any subset, merged over kino defaults) + a free-form guidelines body the agent reads via
  `kino brand <name>`. No brand needed to render. (Replaces the old `brand.json`.)
```

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: all tests pass, including `tests/brand.test.ts` and the empty-disclosure render.

- [ ] **Step 4: Typecheck**

Run: `npm run build`
Expected: tsc clean.

- [ ] **Step 5: Smoke-test end to end**

```bash
mkdir -p /tmp/kb/brands/acme /tmp/kb/specs
printf -- '---\nname: acme\ncolors: { mint: "#22ddaa" }\n---\n# acme\n- calm, plain\n' > /tmp/kb/brands/acme/brand.md
printf '{ "brand": "acme", "title": "t", "segments": [ { "kind": "avatar", "text": "hello there", "caption": "hi" } ] }' > /tmp/kb/specs/t.json
( cd /tmp/kb && node /Users/student/kino/bin/kino.mjs brand acme )           # prints frontmatter + guidelines
( cd /tmp/kb && node /Users/student/kino/bin/kino.mjs build --mock specs/t.json )  # builds with a markdown brand, no JSON
( cd /tmp/kb && printf '{ "title": "t2", "segments": [ { "kind": "avatar", "text": "no brand here", "caption": "hi" } ] }' > specs/t2.json && node /Users/student/kino/bin/kino.mjs build --mock specs/t2.json )  # builds with NO brand at all
```
Expected: `kino brand acme` prints the values + guidelines; both `--mock` builds succeed (markdown brand, and no brand at all). Clean up `/tmp/kb` after.

- [ ] **Step 6: Commit**

```bash
git add skills/video-production/SKILL.md README.md
git commit -m "docs(brand): document optional markdown brands + kino brand"
```

---

## Self-Review

**Spec coverage** (design → task):
- `brand.md` = frontmatter + guidelines body → Task 1 (`parseBrandMd`, `loadBrandDoc`). ✅
- All-optional frontmatter + `DEFAULT_BRAND` merge → Task 1 (`BrandFrontmatterSchema`, `DEFAULT_BRAND`, `mergeBrand`). ✅
- Brand optional, no "No brand" throw → Task 2 (build.ts). ✅
- Disclosure empty by default + render nothing → Task 1 (`disclosure: ""`) + Task 3 (KinoVideo guard). ✅
- Lazy voice (real builds only) + look (non-faceless only) → Task 2 (`resolveVoice` no-throw + the `!mock && !voiceId` check; `validateSpec` drops eager `resolveVoiceLook`; heygen still requires a look in build.ts). ✅
- `kino brand [name]` → Task 4. ✅
- `kino init` scaffolds brand.md → Task 5. ✅
- brand.json no longer read → Task 1 (`loadBrand` reads only `brand.md`). ✅
- Docs (SKILL/README) → Task 6. ✅
- `yaml` dep → Task 1. ✅
- Tests (parse/merge/defaults/missing/malformed, optional brand, lazy validation, empty-disclosure render, `kino brand`, init) → Tasks 1–5. ✅

**Placeholder scan:** none — every code/edit step shows the actual content; the init template uses real YAML.

**Type consistency:** `Brand` (Task 1) is the single complete shape `loadBrand` returns and `DEFAULT_BRAND` satisfies; `BrandFrontmatterSchema`/`BrandFrontmatter` is the all-optional parse type; `mergeBrand(base, fm)` deep-merges colors+captionStyle. `loadBrand(brandDir)` keeps its existing signature (build.ts unchanged except optionality), `loadBrandDoc` adds the body. `resolveVoice` returns `string` (now possibly ""), used by build.ts. `listBrands`/`brandText`/`brand` (Task 4) match the test + cli registration.
