import { describe, it, expect } from "vitest";
import { detectInstallKind } from "../src/commands/update.js";

describe("detectInstallKind", () => {
  it("detects a git clone install (repo root has .git)", () => {
    expect(detectInstallKind("/Users/x/kino", (p) => p === "/Users/x/kino/.git")).toBe("git");
  });
  it("detects an npx cache install (nothing to update)", () => {
    expect(detectInstallKind("/Users/x/.npm/_npx/abc123/node_modules/@sdkv2/kino", () => false)).toBe("npx");
  });
  it("falls back to a global npm install", () => {
    expect(detectInstallKind("/usr/local/lib/node_modules/@sdkv2/kino", () => false)).toBe("global");
  });
});

import { classifyWorkingTree } from "../src/commands/update.js";

describe("classifyWorkingTree", () => {
  it("proceeds on a clean tree", () => {
    expect(classifyWorkingTree("")).toBe("clean");
  });
  it("resets a lockfile-only change (npm version churn blocks pull forever)", () => {
    expect(classifyWorkingTree(" M package-lock.json\n")).toBe("reset-lock");
  });
  it("aborts on real local changes", () => {
    expect(classifyWorkingTree(" M src/cli.ts\n M package-lock.json\n")).toBe("dirty");
  });
});
