import { describe, it, expect } from "vitest";
import { formatCliError } from "../src/cliError.js";

describe("formatCliError", () => {
  it("returns just the message for an Error (not a stack trace)", () => {
    const out = formatCliError(new Error("Brand not found: kino"));
    expect(out).toBe("Brand not found: kino");
    expect(out).not.toMatch(/\n\s+at /); // no stack frames
  });
  it("stringifies a non-Error value", () => {
    expect(formatCliError("boom")).toBe("boom");
    expect(formatCliError(42)).toBe("42");
  });
});
