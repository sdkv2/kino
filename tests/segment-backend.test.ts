import { describe, it, expect } from "vitest";
import { pickBackend } from "../src/segment/backend.js";

describe("pickBackend", () => {
  it("defaults to coreml on darwin", () => {
    expect(pickBackend({ platform: "darwin" })).toBe("coreml");
  });
  it("honors explicit request", () => {
    expect(pickBackend({ platform: "linux", requested: "mock" })).toBe("mock");
    expect(pickBackend({ platform: "darwin", requested: "cuda" })).toBe("cuda");
  });
  it("defaults to cuda off-darwin", () => {
    expect(pickBackend({ platform: "linux" })).toBe("cuda");
    expect(pickBackend({ platform: "win32" })).toBe("cuda");
  });
});
