# Remove Flat Layout (Require a Project) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every kino build require a real `projects/<name>/` (with `project.json`); remove the flat-layout fallback; have `kino init` scaffold a project; fail clearly when building outside one.

**Architecture:** Split `src/config/project.ts` into `resolveWorkspace` (shared brands/cache — for workspace-only commands) and `resolveProject` (now project-required, throws otherwise). Migrate the five workspace-only commands to `resolveWorkspace`, rewrite `init` to scaffold a project, simplify `build.ts`, update tests/docs, bump to v1.16.0.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Commander, Zod, vitest, tsc.

---

## Sequencing rationale (read first)

The order matters so the build/tests stay green after every commit:
1. **Task 1** adds `resolveWorkspace` (additive) and migrates the 5 workspace-only commands to it. `resolveProject` still has its flat fallback, so nothing breaks.
2. **Task 2** rewrites `init` to use `resolveWorkspace` + scaffold a project. After this, `init` no longer calls `resolveProject`.
3. **Task 3** makes `resolveProject` project-required (removes the flat fallback, throws). By now its only callers are `build.ts` and the preview commands (via `prepare`), so the throw is safe.
4. **Task 4** docs + version. **Task 5** final sweep.

Verification: code tasks end in `npm run build` (tsc, exit 0) + `npm test` (vitest, all green). Commit after each task. Commit trailer:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File map
- `src/config/project.ts` — add `resolveWorkspace`; make `resolveProject` project-required; `Workspace`/`Project` interfaces.
- `src/commands/{doctor,voices,transcribe,brand,projects}.ts` — use `resolveWorkspace`.
- `src/commands/init.ts` — rewrite to scaffold workspace + first project.
- `src/commands/build.ts` — simplify project-config load (now always present).
- `tests/project.test.ts` — drop flat test; add throw tests + `resolveWorkspace` test.
- `src/cli.ts` — `init` description + version literal `1.16.0`.
- `package.json` — version `1.16.0`.
- `README.md`, `docs/getting-started.md`, `docs/cli-reference.md`, `CHANGELOG.md` — docs.

---

### Task 1: Add `resolveWorkspace` and migrate workspace-only commands

**Files:**
- Modify: `src/config/project.ts`
- Modify: `src/commands/doctor.ts`, `src/commands/voices.ts`, `src/commands/transcribe.ts`, `src/commands/brand.ts`, `src/commands/projects.ts`
- Test: `tests/project.test.ts`

- [ ] **Step 1: Write the failing test.** Add this block to `tests/project.test.ts` (after the `findUp` describe, before `resolveProject`), and add `resolveWorkspace` to the import on line 2 (`import { resolveProject, resolveWorkspace, findUp } from "../src/config/project.js";`):

```ts
describe("resolveWorkspace", () => {
  it("resolves the shared workspace root, cache, and brand dir", () => {
    const ws = mkdtempSync(join(tmpdir(), "kino-ws-only-"));
    mkdirSync(join(ws, "brands", "acme"), { recursive: true });
    const w = resolveWorkspace(ws);
    expect(w.workspaceRoot).toBe(ws);
    expect(w.cache).toBe(join(ws, ".kino-cache"));
    expect(w.brandDir("acme")).toBe(join(ws, "brands", "acme"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails.**
  Run: `npx vitest run tests/project.test.ts -t "resolves the shared workspace"`
  Expected: FAIL — `resolveWorkspace is not a function` / not exported.

- [ ] **Step 3: Implement `resolveWorkspace` and have `resolveProject` reuse it.** In `src/config/project.ts`, add the `Workspace` interface and `resolveWorkspace`, and refactor `resolveProject` to call it (keep the flat fallback for now — it's removed in Task 3). Replace the interface block + `resolveProject` with:

```ts
export interface Workspace {
  workspaceRoot: string; // holds shared brands/ + .kino-cache
  cache: string;
  brandDir(name: string): string; // shared, at the workspace
}

export interface Project extends Workspace {
  projectRoot: string; // holds this project's specs/ assets/ out/
  projectConfigPath: string | null; // projectRoot/project.json, if present
  isProject: boolean;
  assetPath(rel: string): string; // scoped to the project
  outDir(title: string): string; // scoped to the project
}
```

  Keep `findUp` as-is. Add (above `resolveProject`):

```ts
// Resolve the shared workspace: the nearest ancestor of cwd containing a brands/ dir (else cwd),
// which holds shared brands/ and the .kino-cache. Use this for commands that don't need a project.
export function resolveWorkspace(cwd: string = process.cwd()): Workspace {
  const workspaceRoot = findUp(cwd, "brands") ?? cwd;
  return {
    workspaceRoot,
    cache: join(workspaceRoot, ".kino-cache"),
    brandDir: (name) => join(workspaceRoot, "brands", name),
  };
}
```

  Then change the body of `resolveProject` so its first two lines build on the workspace (leave the rest of the function — projectRoot resolution incl. the `?? workspaceRoot` fallback — unchanged for now):

```ts
export function resolveProject(opts: { specPath?: string; project?: string; cwd?: string } = {}): Project {
  const ws = resolveWorkspace(opts.cwd ?? process.cwd());
  const workspaceRoot = ws.workspaceRoot;

  let projectRoot: string;
  if (opts.project) {
    projectRoot = join(workspaceRoot, "projects", opts.project);
  } else if (opts.specPath) {
    projectRoot = findUp(resolve(dirname(opts.specPath)), "project.json") ?? workspaceRoot;
  } else {
    projectRoot = workspaceRoot;
  }

  const cp = join(projectRoot, "project.json");
  const projectConfigPath = existsSync(cp) ? cp : null;

  return {
    ...ws,
    projectRoot,
    projectConfigPath,
    isProject: projectConfigPath !== null,
    assetPath: (rel) => containedPath(join(projectRoot, "assets"), rel),
    outDir: (title) => join(projectRoot, "out", title),
  };
}
```

- [ ] **Step 4: Run test to verify it passes.**
  Run: `npx vitest run tests/project.test.ts -t "resolves the shared workspace"`
  Expected: PASS.

- [ ] **Step 5: Migrate the five workspace-only commands.** Each only uses `workspaceRoot`. Swap the import and call:
  - `src/commands/doctor.ts`: import `{ resolveWorkspace }`; line 16 → `loadEnv(resolveWorkspace().workspaceRoot);`
  - `src/commands/voices.ts`: import `{ resolveWorkspace }`; line 9 → `loadEnv(resolveWorkspace().workspaceRoot);`
  - `src/commands/transcribe.ts`: import `{ resolveWorkspace }`; lines 27-28 → `const ws = resolveWorkspace();` then `loadEnv(ws.workspaceRoot);` (rename the local from `project` to `ws`; update its later use on the `loadEnv` line only — confirm no other use of that local in the file).
  - `src/commands/brand.ts`: import `{ resolveWorkspace }`; lines 33-34 → `const ws = resolveWorkspace();` then `const brandsRoot = join(ws.workspaceRoot, "brands");` (rename local `project`→`ws`; confirm no other use).
  - `src/commands/projects.ts`: import `{ resolveWorkspace }`; line 8 → `const { workspaceRoot } = resolveWorkspace();`

- [ ] **Step 6: Verify build + full test suite.**
  Run: `npm run build && npm test`
  Expected: tsc exit 0; all vitest suites pass (flat test still present and passing at this stage).

- [ ] **Step 7: Commit.**
```bash
git add src/config/project.ts src/commands/doctor.ts src/commands/voices.ts src/commands/transcribe.ts src/commands/brand.ts src/commands/projects.ts tests/project.test.ts
git commit -m "feat(config): add resolveWorkspace; migrate workspace-only commands to it"
```

---

### Task 2: Rewrite `kino init` to scaffold workspace + first project

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Replace `src/commands/init.ts` entirely** with the version below. It uses `resolveWorkspace`, scaffolds `projects/<brand>/{specs,assets/screens,assets/recordings,out}` + `project.json`, and keeps the existing brand.md template verbatim:

```ts
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveWorkspace } from "../config/project.js";
import { log } from "../log.js";

// Scaffold a workspace + a first project named after the brand. kino requires a project, so init
// produces a ready-to-build one: brands/<brand>/brand.md, .env, and projects/<brand>/ with specs/,
// assets/, out/, and a project.json that assigns the brand.
export async function init(brand = "default"): Promise<void> {
  const ws = resolveWorkspace();
  const projectRoot = join(ws.workspaceRoot, "projects", brand);
  for (const d of [
    ws.brandDir(brand),
    join(projectRoot, "assets", "screens"),
    join(projectRoot, "assets", "recordings"),
    join(projectRoot, "specs"),
    join(projectRoot, "out"),
  ]) {
    mkdirSync(d, { recursive: true });
  }
  const envf = join(ws.workspaceRoot, ".env");
  if (!existsSync(envf)) writeFileSync(envf, "ELEVENLABS_API_KEY=\nHEYGEN_API_KEY=\n");
  const cfg = join(projectRoot, "project.json");
  if (!existsSync(cfg)) writeFileSync(cfg, JSON.stringify({ brand }, null, 2) + "\n");
  const bf = join(ws.brandDir(brand), "brand.md");
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
  log.ok(
    `Initialised project '${brand}'. Fill .env + brands/${brand}/brand.md, add specs under ` +
      `projects/${brand}/specs/, then: kino build projects/${brand}/specs/<spec>.json`,
  );
}
```

- [ ] **Step 2: Verify build.** Run: `npm run build`  Expected: exit 0.

- [ ] **Step 3: Manual smoke (no spend).** Run init in a throwaway dir and confirm the project scaffold:
```bash
D=$(mktemp -d) && (cd "$D" && node /Users/student/kino/dist/cli.js init demo); ls -R "$D" | head -40; cat "$D/projects/demo/project.json"
```
  Expected: `brands/demo/brand.md`, `.env`, and `projects/demo/{specs,assets/screens,assets/recordings,out}` exist; `project.json` is `{ "brand": "demo" }`.

- [ ] **Step 4: Run the suite** (unchanged, but confirm nothing regressed): `npm test`  Expected: all pass.

- [ ] **Step 5: Commit.**
```bash
git add src/commands/init.ts
git commit -m "feat(init): scaffold a project (projects/<brand>/) instead of a flat layout"
```

---

### Task 3: Make `resolveProject` require a project (TDD)

**Files:**
- Modify: `tests/project.test.ts`, `src/config/project.ts`, `src/commands/build.ts`

- [ ] **Step 1: Update the tests.** In `tests/project.test.ts`, replace the entire `describe("resolveProject", …)` block with the version below. This **removes** the flat-mode test, **drops** `isProject` assertions, runs the path-traversal test inside a project, and **adds** the two throw tests:

```ts
describe("resolveProject", () => {
  it("scopes assets/out to the project containing the spec; brands stay at the workspace", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ specPath: join(ws, "projects", "launch", "specs", "hook.json"), cwd: ws });
    expect(p.projectRoot).toBe(join(ws, "projects", "launch"));
    expect(p.assetPath("a.png")).toBe(join(ws, "projects", "launch", "assets", "a.png"));
    expect(p.outDir("t")).toBe(join(ws, "projects", "launch", "out", "t"));
    expect(p.brandDir("acme")).toBe(join(ws, "brands", "acme"));
    expect(p.projectConfigPath).toBe(join(ws, "projects", "launch", "project.json"));
  });
  it("resolves a project by name under projects/", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ project: "launch", cwd: ws });
    expect(p.projectRoot).toBe(join(ws, "projects", "launch"));
  });
  it("throws a clear error when the spec is not inside a project", () => {
    const ws = mkdtempSync(join(tmpdir(), "kino-noproj-"));
    mkdirSync(join(ws, "brands"), { recursive: true });
    writeFileSync(join(ws, "hook.json"), "{}");
    expect(() => resolveProject({ specPath: join(ws, "hook.json"), cwd: ws })).toThrow(/flat layout|No project found/i);
  });
  it("throws when a named project has no project.json", () => {
    const ws = makeWorkspace();
    expect(() => resolveProject({ project: "ghost", cwd: ws })).toThrow(/Project 'ghost' not found/i);
  });
  it("allows nested asset paths but rejects ones that escape the project assets dir (path traversal)", () => {
    const ws = makeWorkspace();
    const p = resolveProject({ project: "launch", cwd: ws });
    expect(p.assetPath("screens/x.png")).toBe(join(ws, "projects", "launch", "assets", "screens", "x.png"));
    expect(() => p.assetPath("../../../../etc/passwd")).toThrow(/escape/i);
    expect(() => p.assetPath("motion/../../../secret.js")).toThrow(/escape/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail.**
  Run: `npx vitest run tests/project.test.ts`
  Expected: FAIL — the two "throws" tests fail (current code falls back to flat instead of throwing); the others may also error on `isProject`/shape.

- [ ] **Step 3: Make `resolveProject` project-required.** In `src/config/project.ts`: (a) in the `Project` interface remove the `isProject` line and change `projectConfigPath: string | null;` to `projectConfigPath: string; // projectRoot/project.json (always present — a project requires one)`. (b) Replace the `resolveProject` body with:

```ts
// Resolve the shared workspace AND the active project. kino requires a project: specs/assets/out
// live under projects/<name>/ with a project.json. Throws (no flat fallback) when none resolves.
//   - project name → workspaceRoot/projects/<name>   (must contain project.json)
//   - spec path    → nearest ancestor that contains project.json
export function resolveProject(opts: { specPath?: string; project?: string; cwd?: string } = {}): Project {
  const ws = resolveWorkspace(opts.cwd ?? process.cwd());

  let projectRoot: string | null;
  if (opts.project) {
    projectRoot = join(ws.workspaceRoot, "projects", opts.project);
  } else if (opts.specPath) {
    projectRoot = findUp(resolve(dirname(opts.specPath)), "project.json");
  } else {
    projectRoot = null;
  }

  if (!projectRoot || !existsSync(join(projectRoot, "project.json"))) {
    if (opts.project) {
      throw new Error(
        `Project '${opts.project}' not found at projects/${opts.project}/ (no project.json). ` +
          `Create it with: kino projects --new ${opts.project} --brand <brand>`,
      );
    }
    const where = opts.specPath ? `spec '${opts.specPath}'` : "this command";
    throw new Error(
      `No project found for ${where}. kino no longer supports a flat layout — every spec must live ` +
        `under projects/<name>/specs/. Create one with: kino projects --new <name> --brand <brand>`,
    );
  }

  const pr = projectRoot; // narrowed to string
  return {
    ...ws,
    projectRoot: pr,
    projectConfigPath: join(pr, "project.json"),
    assetPath: (rel) => containedPath(join(pr, "assets"), rel),
    outDir: (title) => join(pr, "out", title),
  };
}
```

- [ ] **Step 4: Simplify `build.ts` (projectConfigPath is now always present).** In `src/commands/build.ts` line 93, change:
```ts
  const pc = project.projectConfigPath ? loadProjectConfig(project.projectConfigPath) : undefined;
```
  to:
```ts
  const pc = loadProjectConfig(project.projectConfigPath);
```
  Line 94 (`const brandName = spec.brand ?? pc?.brand;`) keeps working (`?.` on a defined value is valid); optionally tighten to `pc.brand`. Do not change any other logic.

- [ ] **Step 5: Run tests to verify they pass.**
  Run: `npx vitest run tests/project.test.ts`
  Expected: PASS (all resolveProject + resolveWorkspace tests green).

- [ ] **Step 6: Verify the full build + suite.**
  Run: `npm run build && npm test`
  Expected: tsc exit 0; all vitest suites pass. (tsc will flag any lingering `isProject`/`projectConfigPath`-null usage — there should be none beyond build.ts:93, already fixed.)

- [ ] **Step 7: Commit.**
```bash
git add src/config/project.ts src/commands/build.ts tests/project.test.ts
git commit -m "feat(config): require a project — remove flat-layout fallback, throw with guidance"
```

---

### Task 4: Docs + version bump (v1.16.0) + CHANGELOG

**Files:**
- Modify: `src/cli.ts`, `package.json`, `README.md`, `docs/getting-started.md`, `docs/cli-reference.md`, `CHANGELOG.md`

- [ ] **Step 1: Bump the version in two places.**
  - `package.json`: change `"version": "1.15.0"` → `"version": "1.16.0"`.
  - `src/cli.ts` line 11: change `.version("1.15.0")` → `.version("1.16.0")`.

- [ ] **Step 2: Update the `init` command description in `src/cli.ts` line 137.** Change:
```ts
  .description("Scaffold .env, a brand config, and project dirs")
```
  to:
```ts
  .description("Scaffold .env, a brand, and a first project under projects/<brand>")
```

- [ ] **Step 3: Update `README.md` lines 60-61.** Replace:
```
- **Brands & projects** — optional `brands/<name>/brand.md` (markdown frontmatter + guidelines);
  `projects/<name>/` scopes each campaign's specs/assets/out. Flat layout still works.
```
  with:
```
- **Brands & projects** — `brands/<name>/brand.md` (markdown frontmatter + guidelines) is shared;
  every build runs inside a `projects/<name>/` (its own specs/assets/out + a `project.json` that
  assigns a brand). `kino init <brand>` scaffolds the first one; `kino projects --new` adds more.
```

- [ ] **Step 4: Update `docs/getting-started.md`.**
  - Line 49 comment: change `# scaffold .env, a brand.md, and project dirs` → `# scaffold .env, a brand.md, and projects/acme/`.
  - Replace lines 52-55 (the "two layouts" intro + both bullets):
```
kino supports two layouts:

- **Projects** (recommended) — `kino projects --new <name> --brand <brand>` creates `projects/<name>/` with its own `specs/`, `assets/`, and `out/`, plus a `project.json` that assigns a brand and default overrides. `kino projects` lists what exists.
- **Flat** — a single `specs/`, `assets/`, `out/`, and `brand.md` at the repo root (back-compat; still works).
```
  with:
```
Every build runs inside a **project**:

- `kino init <brand>` scaffolds the workspace plus a first project named after the brand: `projects/<brand>/` with its own `specs/`, `assets/`, and `out/`, plus a `project.json` that assigns the brand.
- `kino projects --new <name> --brand <brand>` adds more projects; `kino projects` lists what exists.
- A spec must live under a project's `specs/`. Building a spec that isn't inside a project fails with a message telling you to create one.
```

- [ ] **Step 5: Update `docs/cli-reference.md` lines 114-115 (the `init` entry).** Replace:
```
### `init`
Scaffold `.env`, a brand config, and project directories.
```
  with:
```
### `init [brand]`
Scaffold the workspace (`.env`, `brands/<brand>/brand.md`) plus a first project `projects/<brand>/` (with `specs/`, `assets/`, `out/`, and a `project.json` assigning the brand). Builds require a project, so this produces a ready-to-build layout. Defaults the brand/project name to `default`.
```

- [ ] **Step 6: Add a CHANGELOG entry.** In `CHANGELOG.md`, insert directly under the `# Changelog` header block (above `## [1.15.0]`):
```markdown
## [1.16.0] — Require a project (BREAKING)
- **BREAKING:** removed the flat layout. Every build must run inside a `projects/<name>/` (with a
  `project.json`); building a spec outside a project now fails with guidance instead of silently
  using the workspace root.
- `kino init <brand>` now scaffolds the workspace **and** a first project (`projects/<brand>/`),
  rather than a flat layout.
- Internals: split `resolveWorkspace` (shared brands/cache) from `resolveProject` (project-required).
```

- [ ] **Step 7: Verify.**
  Run: `npm run build` (expect exit 0) and `grep -rni 'flat\|back-compat' README.md docs/getting-started.md docs/cli-reference.md docs/spec-reference.md` (expect no results in these user docs).

- [ ] **Step 8: Commit.**
```bash
git add src/cli.ts package.json README.md docs/getting-started.md docs/cli-reference.md CHANGELOG.md
git commit -m "docs: require-project flow + v1.16.0 (BREAKING: flat layout removed)"
```

---

### Task 5: Final verification sweep

- [ ] **Step 1: Full build + test.** Run: `npm run build && npm test`  Expected: tsc exit 0; all vitest suites pass.

- [ ] **Step 2: No flat layout remains in code/user-docs.**
```bash
grep -rni 'flat' src/config/project.ts src/commands/init.ts          # expect: none
grep -rni 'flat\|back-compat' README.md docs/getting-started.md docs/cli-reference.md docs/spec-reference.md   # expect: none
grep -n '1\.15\.0' package.json src/cli.ts                            # expect: none (now 1.16.0)
```

- [ ] **Step 3: Behavior smoke (no spend).** Confirm both the happy path and the new error:
```bash
D=$(mktemp -d)
(cd "$D" && node /Users/student/kino/dist/cli.js init demo) && echo "init OK"
echo '{"title":"x","segments":[]}' > "$D/loose.json"
(cd "$D" && node /Users/student/kino/dist/cli.js build loose.json --mock) ; echo "exit=$?"
```
  Expected: `init` succeeds and creates `projects/demo/`; the loose-spec build prints the "No project found … kino no longer supports a flat layout …" error and exits non-zero (exit=1).

- [ ] **Step 4:** If the sweep surfaced anything, fix + re-run; otherwise the branch is ready for review/merge per superpowers:finishing-a-development-branch.

---

## Self-review notes (author)

- **Spec coverage:** workspace/project split → Task 1 + Task 3; required-project error → Task 3; `init` scaffolds a project → Task 2; workspace-only commands keep working → Task 1; build.ts simplification → Task 3; tests → Tasks 1 & 3; docs + version + CHANGELOG → Task 4; verification → Task 5.
- **Sequencing:** `resolveWorkspace` added before any caller migrates; `init` rewritten before `resolveProject` starts throwing; build is `resolveProject`'s only remaining caller when the throw lands.
- **Type/name consistency:** `resolveWorkspace`/`Workspace`/`Project` (extends `Workspace`), `projectConfigPath` becomes non-null in Task 3 (only consumer `build.ts:93` updated same task), `isProject` removed (only consumers were tests, updated Task 3).
- **No behavior change beyond the spec:** brand/override resolution, caching, rendering untouched; only the project requirement + init scaffold change.
