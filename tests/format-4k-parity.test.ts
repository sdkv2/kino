// Cheap, pure-logic coverage for the 4k/1080 authoring-canvas mapping. The one real render +
// magick pixel compare that used to live in this file is now tests/format-4k-render.test.ts,
// which is GPU_PIXEL_TESTS-excluded from KINO_TEST_SCOPE=light — see vitest.config.ts.
import { describe, it, expect } from "vitest";
import { baseFormat, compDims } from "../src/render/formats.js";

describe("compDims", () => {
  it("maps every format to its 1080-class authoring canvas", () => {
    expect(baseFormat("9:16-4k")).toBe("9:16");
    expect(baseFormat("9:16")).toBe("9:16");
    expect(compDims("9:16-4k")).toEqual({ width: 1080, height: 1920 });
    expect(compDims("16:9-4k")).toEqual({ width: 1920, height: 1080 });
    expect(compDims("3:4-4k")).toEqual({ width: 1080, height: 1440 });
    expect(compDims("9:16")).toEqual({ width: 1080, height: 1920 });
  });
});
