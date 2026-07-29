import { describe, it, expect } from "vitest";
import { groupRuns, groupsOf } from "../src/render/native/page/compositor/groups.js";
import { normalizeLayer } from "../src/render/native/page/compositor/graph.js";

const layer = (id: string, group?: string) =>
  normalizeLayer({ id, source: { providerId: id }, rect: { x: 0, y: 0, w: 10, h: 10 }, group });

const adjustment = (id: string) =>
  normalizeLayer({
    id,
    source: null,
    rect: { x: 0, y: 0, w: 10, h: 10 },
    adjust: [{ kind: "film", params: { intensity: 1 } }],
  });

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

describe("groupRuns", () => {
  it("keeps consecutive same-group layers in one run", () => {
    const runs = groupRuns([layer("backdrop"), layer("scrim"), layer("seg0", "beat0"), layer("cap0", "beat0")]);
    expect(runs.map((r) => r.map((l) => l.id))).toEqual([["backdrop", "scrim"], ["seg0", "cap0"]]);
  });

  it("breaks a run when the group changes and back again", () => {
    const runs = groupRuns([layer("seg0", "beat0"), layer("logo"), layer("cap0", "beat0")]);
    expect(runs.map((r) => r.map((l) => l.id))).toEqual([["seg0"], ["logo"], ["cap0"]]);
  });

  // An adjustment consumes everything composited beneath it, so it is a barrier in the walk.
  // Without this it would ride along in a base run and never get its chance to run its chain.
  it("gives an adjustment layer a run of its own, even among base layers", () => {
    const runs = groupRuns([layer("backdrop"), layer("scrim"), adjustment("film"), layer("logo")]);
    expect(runs.map((r) => r.map((l) => l.id))).toEqual([["backdrop", "scrim"], ["film"], ["logo"]]);
  });

  it("keeps two adjustments in separate runs", () => {
    const runs = groupRuns([adjustment("film"), adjustment("grade")]);
    expect(runs.map((r) => r.map((l) => l.id))).toEqual([["film"], ["grade"]]);
  });

  it("returns no runs for no layers", () => {
    expect(groupRuns([])).toEqual([]);
  });
});
