import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

// A GLSL program that will not compile used to render as a flat wash with no diagnostic: the
// page console.error'd (invisible unless KINO_NATIVE_DEBUG) and the beat carried on without the
// shader, so the build "succeeded" and shipped a broken frame. See page/fatal.ts.

const theme = {
  font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20",
  white: "#fff", captionFontSize: 74, captionStroke: 9,
};

function propsWithShader(shaderCode: string): KinoProps {
  return {
    theme,
    fps: 30,
    avatar: null,
    avatarWindows: [],
    voTrack: null,
    logo: null,
    background: {
      kind: "custom", image: null, customCode: null, shaderCode,
      params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
      keyframes: [], triggers: [],
    },
    disclosure: "test",
    segments: [{ kind: "avatar", caption: "hi", startSec: 0, endSec: 1 }],
  };
}

const render = (shaderCode: string) =>
  renderStills({
    props: propsWithShader(shaderCode),
    publicDir: mkdtempSync(join(tmpdir(), "kino-glslpub-")),
    format: "9:16",
    frames: [{ frame: 0, name: "f0" }],
    outDir: mkdtempSync(join(tmpdir(), "kino-glslout-")),
  });

describe("GLSL failures are loud", () => {
  it("fails the render instead of emitting a flat frame", async () => {
    // `vec3 col = ;` — a syntax error the driver rejects outright.
    const broken = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
      vec3 col = ;
      fragColor = vec4(col, 1.0);
    }`;
    await expect(render(broken)).rejects.toThrow(/ShaderBackground failed to build/);
  }, 120_000);

  it("reports the driver log and numbered assembled source", async () => {
    const broken = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
      fragColor = notAFunction(fragCoord);
    }`;
    // The log cites a line in the *assembled* source, which the author never sees on disk —
    // so the numbered listing has to travel with it to be actionable.
    await expect(render(broken)).rejects.toThrow(/assembled source[\s\S]*\d+ \| /);
  }, 120_000);

  it("still renders when the shader is valid", async () => {
    const ok = `void mainImage(out vec4 fragColor, in vec2 fragCoord) {
      fragColor = vec4(fragCoord / iResolution.xy, 0.0, 1.0);
    }`;
    const outs = await render(ok);
    expect(outs).toHaveLength(1);
  }, 120_000);
});
