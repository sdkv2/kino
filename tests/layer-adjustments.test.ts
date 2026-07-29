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
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
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
