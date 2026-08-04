// The cinematic finish is a layer, not a hardcoded pass. It sits at Z.film with no texture
// source and an `adjust` chain, meaning "apply these to everything composited beneath me".
import { describe, it, expect } from "vitest";
import { layersAt, Z } from "../src/render/layers.js";
import type { KinoProps, KinoSegment } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9, film: 1,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const DIMS = { width: 1080, height: 1920 };
const mk = (segments: KinoSegment[], over: Partial<KinoProps> = {}): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments, ...over,
});

describe("film as an adjustment layer", () => {
  const p = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }]);

  it("emits a sourceless adjustment entry at Z.film", () => {
    const film = layersAt(p, 30, DIMS).find((l) => l.id === "film")!;
    expect(film).toBeDefined();
    expect(film.z).toBe(Z.film);
    expect(film.source).toBeNull();
    expect(film.adjust).toEqual([{ kind: "film", params: expect.objectContaining({ intensity: 1 }) }]);
  });

  it("sorts between the grained content and the clean type", () => {
    const ids = layersAt(p, 30, DIMS).map((l) => l.id);
    expect(ids.indexOf("scrim")).toBeLessThan(ids.indexOf("film"));
    expect(ids.indexOf("film")).toBeLessThan(ids.indexOf("caption0"));
  });

  it("omits the entry entirely when the finish is disabled", () => {
    const off = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      theme: { ...theme, film: 0 },
    });
    expect(layersAt(off, 30, DIMS).find((l) => l.id === "film")).toBeUndefined();
  });

  it("takes params from postFx.film over theme.film", () => {
    const tuned = mk([{ kind: "scene", caption: "hi", startSec: 0, endSec: 3 }], {
      postFx: { film: { intensity: 0.4, grain: 2 } },
    } as Partial<KinoProps>);
    const film = layersAt(tuned, 30, DIMS).find((l) => l.id === "film")!;
    expect(film.adjust![0].params).toMatchObject({ intensity: 0.4, grain: 2 });
  });
});

// An adjustment layer used to span the whole composition by construction, which is why per-beat
// grain was inexpressible: `film` is one chain over everything, and the only knob was a single
// intensity for the entire piece. It resolves the same window every other declared layer does now.
describe("windowed adjustment layers", () => {
  const beats: KinoSegment[] = [
    { kind: "scene", caption: "one", startSec: 0, endSec: 2 },
    { kind: "scene", caption: "two", startSec: 2, endSec: 4 },
  ];
  const grain = (over: Record<string, unknown>) => ({
    id: "beat-grain",
    z: 701,
    adjust: [{ kind: "film" as const, params: { intensity: 1, grain: 1.8, vignette: 0 } }],
    ...over,
  });
  const at = (frame: number, over: Record<string, unknown>) =>
    layersAt(mk(beats, { layers: [grain(over)] } as Partial<KinoProps>), frame, DIMS)
      .find((l) => l.id === "beat-grain");

  it("still spans everything when nothing narrows it", () => {
    expect(at(0, {})).toBeDefined();
    expect(at(110, {})).toBeDefined();
  });

  it("appears only inside fromSec/toSec", () => {
    expect(at(20, { fromSec: 0.5, toSec: 1.5 })).toBeDefined();
    expect(at(3, { fromSec: 0.5, toSec: 1.5 })).toBeUndefined();
    expect(at(60, { fromSec: 0.5, toSec: 1.5 })).toBeUndefined();
  });

  it("borrows a beat's window when bound to one", () => {
    expect(at(30, { segment: 0 })).toBeDefined();
    expect(at(75, { segment: 0 })).toBeUndefined();
    expect(at(75, { segment: 1 })).toBeDefined();
  });

  it("stays out of the beat's group — an adjustment cannot crossfade with one", () => {
    expect(at(30, { segment: 0 })!.group).toBeUndefined();
  });

  it("runs its effect keyframes on the layer's own clock, not the timeline's", () => {
    // Bound to beat 1 (starts at 2s), ramping intensity over its first second. At the beat's own
    // half-second mark the ramp is halfway — which is only true if `at` counts from the beat.
    const ramp = {
      id: "beat-grain",
      z: 701,
      segment: 1,
      adjust: [
        {
          kind: "film" as const,
          params: { intensity: 0, grain: 1.8, vignette: 0 },
          keyframes: [{ at: 0, params: { intensity: 0 } }, { at: 1, params: { intensity: 1 } }],
        },
      ],
    };
    const props = mk(beats, { layers: [ramp] } as Partial<KinoProps>);
    const at15 = layersAt(props, 75, DIMS).find((l) => l.id === "beat-grain")!;
    expect(at15.adjust![0].params.intensity).toBeCloseTo(0.5, 2);
  });
});
