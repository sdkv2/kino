import { describe, it, expect } from "vitest";
import { pickBackend } from "../src/segment/backend.js";

describe("pickBackend", () => {
  it("defaults to coreml on darwin", () => {
    expect(pickBackend({ platform: "darwin" })).toBe("coreml");
  });
  it("honors explicit request", () => {
    expect(pickBackend({ platform: "linux", requested: "mock" })).toBe("mock");
  });
  it("throws backend_unavailable off-darwin without request", () => {
    expect(() => pickBackend({ platform: "linux" })).toThrow(/backend_unavailable/);
  });
});
