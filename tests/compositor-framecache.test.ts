import { describe, it, expect } from "vitest";
import { frameSignatures } from "../src/render/native/frameCache.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64",
  gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9,
};
const bg = { kind: "glow" as const, image: null, customCode: null, shaderCode: null, params: {}, keyframes: [], triggers: [] };
const props: KinoProps = {
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null,
  background: bg, disclosure: "", segments: [{ kind: "scene", caption: "hi", startSec: 0, endSec: 2 }],
};

const sigs = (compositor: boolean) =>
  frameSignatures({
    props, publicDir: mkdtempSync(join(tmpdir(), "fc-")), pageJsHash: "abc",
    width: 1080, height: 1920, total: 10, fps: 30, mode: "sw", compositor,
  });

describe("frameSignatures — compositor separation", () => {
  it("gives DOM-path and compositor frames different signatures", () => {
    expect(sigs(false)[0]).not.toBe(sigs(true)[0]);
  });

  it("is stable for the same path", () => {
    expect(sigs(true)[0]).toBe(sigs(true)[0]);
  });
});
