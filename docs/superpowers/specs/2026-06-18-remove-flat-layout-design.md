# kino — remove flat layout (require a project)

**Date:** 2026-06-18 · **Status:** design approved, pending spec review → writing-plans

## Summary
kino currently supports two workspace layouts: **project** (`projects/<name>/` with a `project.json`
scoping `specs/assets/out`) and **flat** (those dirs at the workspace root, used as a back-compat
fallback whenever no `project.json` is found). This change **removes the flat layout**: every build
must resolve to a real project, and building outside one fails with a clear, actionable error.

This is a behavior change (a back-compat break). The only allowed scope is what's needed to require
projects and update the surrounding scaffolding/docs/tests.

## Goals
- A build (`build`/`still`/`storyboard`/`inspect`) only succeeds when its spec lives under a
  `projects/<name>/` that has a `project.json`. No silent fallback to the workspace root.
- A build that can't resolve a project fails with a clear message telling the user how to fix it.
- `kino init <brand>` scaffolds a ready-to-build **project**, not a flat layout.
- Workspace-only commands (`doctor`, `voices`, `transcribe`, `brand`, `projects`) keep working
  unchanged — they only ever needed the shared workspace, not a project.
- `npm run build` (tsc) and `npm test` (vitest) stay green.

## Non-goals (out of scope)
- No migration tooling (clean break — there is no flat content to preserve).
- No change to how `project.json` brand/override resolution works, beyond making a project mandatory.
- No change to brand resolution, caching, rendering, or any other subsystem.

## Current behavior (what's being removed)
`src/config/project.ts` `resolveProject({specPath?, project?, cwd?})` resolves the workspace
(`findUp(cwd, "brands") ?? cwd`) and the project root:
- `project` name → `workspaceRoot/projects/<name>`
- `specPath` → `findUp(spec dir, "project.json") ?? workspaceRoot`  ← **flat fallback**
- neither → `workspaceRoot`  ← **flat fallback**

`isProject = projectConfigPath !== null`. In flat mode `projectRoot === workspaceRoot`,
`projectConfigPath === null`, `isProject === false`. Consumers:
- `build.ts:88,93` — `resolveProject({specPath, project})`; `pc = projectConfigPath ? loadProjectConfig(...) : undefined` (so flat builds get brand from `spec.brand`/`DEFAULT_BRAND`).
- `doctor.ts`, `voices.ts`, `transcribe.ts`, `brand.ts`, `projects.ts` — call `resolveProject()` only for `.workspaceRoot`.
- `init.ts` — `resolveProject()` (flat) and scaffolds `specs/assets/out` at the workspace root.
- `isProject` is read only by `tests/project.test.ts`.

## Design

### 1. Split workspace vs. project resolution (`src/config/project.ts`)
Separate the two concerns so each function has one clear purpose:

- **`resolveWorkspace(cwd?): { workspaceRoot, cache, brandDir(name) }`** — resolves the shared
  workspace (`findUp(cwd, "brands") ?? cwd`, `.kino-cache`, `brands/<name>`). Used by the
  workspace-only commands.
- **`resolveProject({specPath?, project?, cwd?}): Project`** — resolves the workspace (via
  `resolveWorkspace`) **and a required project**. The flat fallback is removed; it throws when no
  project resolves:
  - `project` given → `projects/<name>`; throw if `projects/<name>/project.json` is absent.
  - `specPath` given → `findUp(spec dir, "project.json")`; throw if none found.
  - neither → throw (a build always has a spec or project; defensive).

  `Project` changes: drop `isProject`; `projectConfigPath` becomes non-null (`string`). `projectRoot`
  is always a real project dir. `workspaceRoot`, `cache`, `brandDir`, `assetPath`, `outDir`,
  `containedPath`, `findUp` keep their current semantics.

### 2. Error messages
Spec not inside a project:
```
No project found for spec '<specPath>'. kino no longer supports a flat layout — every spec must live
under projects/<name>/specs/. Create one with: kino projects --new <name> --brand <brand>
```
Named project missing `project.json`:
```
Project '<name>' not found at projects/<name>/ (no project.json). Create it with:
kino projects --new <name> --brand <brand>
```

### 3. Rewrite `kino init <brand>` (`src/commands/init.ts`)
Scaffold workspace + first project in one command (first project named after the brand):
- workspace: `brands/<brand>/brand.md` (same template as today) + `.env` (same as today, if absent).
- project: `projects/<brand>/{specs, assets/screens, assets/recordings, out}` +
  `projects/<brand>/project.json` containing `{ "brand": "<brand>" }` (only if absent).
- success log points at the new project: fill `.env` + `brands/<brand>/brand.md`, add specs under
  `projects/<brand>/specs/`, then `kino build projects/<brand>/specs/<spec>.json`.

### 4. Update callers
- `doctor.ts`, `voices.ts`, `transcribe.ts`, `brand.ts`, `projects.ts` — swap
  `resolveProject(...).workspaceRoot` for `resolveWorkspace(...).workspaceRoot` (one line each;
  `brand.ts` also uses `workspaceRoot` for `brands/`).
- `build.ts` — `resolveProject({specPath, project})` now throws on no project (no call-site change
  needed); simplify line 93 to always `loadProjectConfig(project.projectConfigPath)` since it's
  non-null. Brand still resolves as `spec.brand ?? pc.brand` then `DEFAULT_BRAND`.

### 5. Tests (`tests/project.test.ts`)
- Remove the "flat mode" test.
- Rewrite the path-traversal test to run inside a project (resolve via `specPath` or `project`).
- Update the by-spec and by-name tests to drop `isProject` assertions.
- Add: `resolveProject` throws when a spec isn't inside a project; throws when a named project lacks
  `project.json`.
- Add a `resolveWorkspace` test (workspaceRoot/brandDir).

### 6. Docs + version
- `README.md` — remove "Flat layout still works"; state that a project is required; reflect that
  `init` scaffolds a project.
- `docs/getting-started.md` — remove the "Flat" bullet; update the init/projects flow.
- `docs/cli-reference.md` / `docs/spec-reference.md` — reconcile any flat/`init` description.
- `CHANGELOG.md` — add a **v1.16.0** entry flagged **BREAKING: flat layout removed; a project is now required**.
- Bump version to **1.16.0** in `package.json` **and** the hardcoded literal(s) in `src/cli.ts`.

## Verification
- `npm run build` exits 0; `npm test` all green.
- Manual smoke (mock, no spend): `kino init demo` produces `projects/demo/` with `project.json`;
  a build of a spec placed outside any project fails with the project-required error.
