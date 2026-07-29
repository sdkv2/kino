import { describe, it, expect } from "vitest";
import { layersAt } from "../src/render/layers.js";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = {
  kind: "glow" as const, image: null, customCode: null, shaderCode: null,
  params: {}, keyframes: [], triggers: [],
};
const DIMS = { width: 1080, height: 1920 };

const base: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null,
  background: bg, disclosure: "", segments: [],
};

describe("layersAt — backdrop", () => {
  it("always emits the brand backdrop as the bottom layer, full frame", () => {
    const layers = layersAt(base, 0, DIMS);
    expect(layers[0].id).toBe("backdrop");
    expect(layers[0].source.providerId).toBe("backdrop");
    expect(layers[0].rect).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(layers[0].opacity).toBe(1);
  });

  it("emits no avatar layer when there is no avatar", () => {
    expect(layersAt(base, 0, DIMS).some((l) => l.id.startsWith("av"))).toBe(false);
  });
});

describe("layersAt — avatar windows", () => {
  const withAvatar: KinoProps = {
    ...base,
    avatar: { src: "avatar.mp4" } as unknown as KinoProps["avatar"],
    avatarWindows: [{ fromSec: 1, toSec: 3, audioStartSec: 0 }],
  };

  it("emits the avatar clip only inside its window", () => {
    expect(layersAt(withAvatar, 0, DIMS).some((l) => l.id === "av0")).toBe(false);
    expect(layersAt(withAvatar, 45, DIMS).some((l) => l.id === "av0")).toBe(true);
    expect(layersAt(withAvatar, 95, DIMS).some((l) => l.id === "av0")).toBe(false);
  });

  it("applies the push-in: scale 1.0 at window start rising to 1.08 at window end", () => {
    const at = (f: number) => layersAt(withAvatar, f, DIMS).find((l) => l.id === "av0")!;
    expect(at(30).transform.scale).toBeCloseTo(1.0, 5);
    expect(at(89).transform.scale).toBeCloseTo(1.08, 2);
  });

  it("sits above the backdrop and scrim", () => {
    const layers = layersAt(withAvatar, 45, DIMS);
    expect(layers.map((l) => l.id).slice(0, 3)).toEqual(["backdrop", "scrim", "av0"]);
  });
});
