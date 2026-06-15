import { describe, it, expect } from "vitest";
import { renderVideo } from "../src/render/render.js";
import { probeDuration } from "../src/media/ffmpeg.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KinoProps } from "../src/render/props.js";

describe("renderVideo (mock, no avatar)", () => {
  it("renders a 9:16 mp4 from caption-only segments", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-r-"));
    const props: KinoProps = {
      theme: { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 },
      fps: 30,
      avatar: null,
      disclosure: "test",
      segments: [{ kind: "avatar", caption: "hello", startSec: 0, endSec: 2 }],
    };
    const outs = await renderVideo({ props, publicDir: outDir, formats: ["9:16"], outDir, title: "t" });
    expect(outs).toHaveLength(1);
    expect(await probeDuration(outs[0])).toBeCloseTo(2, 0);
  }, 180000);
});
