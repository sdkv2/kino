import { describe, it, expect } from "vitest";
import {
  FORMAT_DIMS,
  formatFileTag,
  maxOutputDim,
  parseFormatList,
  isFormatId,
} from "../src/render/formats.js";
import { SpecSchema } from "../src/spec/schema.js";

describe("formats", () => {
  it("maps 1080-class and 4k canvases", () => {
    expect(FORMAT_DIMS["9:16"]).toEqual({ width: 1080, height: 1920 });
    expect(FORMAT_DIMS["9:16-4k"]).toEqual({ width: 2160, height: 3840 });
    expect(FORMAT_DIMS["16:9-4k"]).toEqual({ width: 3840, height: 2160 });
    expect(FORMAT_DIMS["3:4-4k"]).toEqual({ width: 2160, height: 2880 });
  });

  it("keeps aspect between 1080 and 4k twins", () => {
    for (const base of ["9:16", "3:4", "16:9"] as const) {
      const a = FORMAT_DIMS[base];
      const b = FORMAT_DIMS[`${base}-4k`];
      expect(a.width / a.height).toBeCloseTo(b.width / b.height, 5);
      expect(b.width * b.height).toBe(a.width * a.height * 4);
    }
  });

  it("file-tags 4k formats without eating the suffix", () => {
    expect(formatFileTag("9:16")).toBe("9x16");
    expect(formatFileTag("9:16-4k")).toBe("9x16-4k");
    expect(formatFileTag("16:9-4k")).toBe("16x9-4k");
  });

  it("maxOutputDim prefers 4k when mixed", () => {
    expect(maxOutputDim(["9:16"])).toBe(1920);
    expect(maxOutputDim(["9:16", "16:9-4k"])).toBe(3840);
  });

  it("parseFormatList validates", () => {
    expect(parseFormatList("9:16,16:9-4k")).toEqual(["9:16", "16:9-4k"]);
    expect(() => parseFormatList("8k")).toThrow(/unknown format/);
    expect(isFormatId("9:16-4k")).toBe(true);
    expect(isFormatId("4k")).toBe(false);
  });

  it("SpecSchema accepts *-4k formats", () => {
    const s = SpecSchema.parse({
      title: "uhd",
      format: ["9:16-4k", "16:9-4k"],
      segments: [{ kind: "scene", text: "hi" }],
    });
    expect(s.format).toEqual(["9:16-4k", "16:9-4k"]);
  });
});
