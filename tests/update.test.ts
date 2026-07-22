import { describe, it, expect } from "vitest";
import { join, sep } from "node:path";
import { detectInstallKind, classifyWorkingTree } from "../src/commands/update.js";

describe("detectInstallKind", () => {
  const root = join(sep, "u", "kino"); // native separators — CI runs this on windows too
  it("detects a git clone install (repo root has .git)", () => {
    expect(detectInstallKind(root, (p) => p === join(root, ".git"))).toBe("git");
  });
  it("detects an npx cache install (nothing to update)", () => {
    const npxRoot = ["", "u", ".npm", "_npx", "abc123", "node_modules", "@sdkv2", "kino"].join(sep);
    expect(detectInstallKind(npxRoot, () => false)).toBe("npx");
  });
  it("detects _npx regardless of separator style", () => {
    expect(detectInstallKind("C:\\u\\.npm\\_npx\\abc\\node_modules\\@sdkv2\\kino", () => false)).toBe("npx");
    expect(detectInstallKind("/u/.npm/_npx/abc/node_modules/@sdkv2/kino", () => false)).toBe("npx");
  });
  it("falls back to a global npm install", () => {
    expect(detectInstallKind(join(sep, "usr", "lib", "node_modules", "@sdkv2", "kino"), () => false)).toBe("global");
  });
});

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
