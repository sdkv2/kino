import { describe, it, expect } from "vitest";
import { groupsOf } from "../src/render/native/page/compositor/groups.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const layer = (id: string, group?: string) =>
  normalizeLayer({ id, source: { providerId: id }, rect: { x: 0, y: 0, w: 10, h: 10 }, group });

describe("groupsOf", () => {
  it("puts ungrouped layers in the base group", () => {
    const g = groupsOf([layer("backdrop"), layer("film")]);
    expect([...g.keys()]).toEqual(["base"]);
    expect(g.get("base")!.map((l) => l.id)).toEqual(["backdrop", "film"]);
  });

  it("separates layers by group, preserving order within each", () => {
    const g = groupsOf([layer("backdrop"), layer("seg1", "beat1"), layer("cap1", "beat1"), layer("seg2", "beat2")]);
    expect(g.get("beat1")!.map((l) => l.id)).toEqual(["seg1", "cap1"]);
    expect(g.get("beat2")!.map((l) => l.id)).toEqual(["seg2"]);
  });

  it("preserves first-appearance order of the groups themselves", () => {
    const g = groupsOf([layer("a", "x"), layer("b", "y"), layer("c", "x")]);
    expect([...g.keys()]).toEqual(["x", "y"]);
  });

  it("returns an empty map for no layers", () => {
    expect(groupsOf([]).size).toBe(0);
  });
});
