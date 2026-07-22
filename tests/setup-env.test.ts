import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script, no types
import { parseEnv } from "../setup.mjs";

describe("setup.mjs parseEnv", () => {
  it("parses KEY=value, strips quotes, skips comments/garbage", () => {
    const env = parseEnv(
      [
        "# kino API keys — DO NOT COMMIT",
        "ELEVENLABS_API_KEY=sk_abc",
        'PEXELS_API_KEY="quoted"',
        "HEDRA_API_KEY='single'",
        "  SPACED_KEY = padded",
        "not a key line",
        "lowercase=ignored",
      ].join("\n"),
    );
    expect(env).toEqual({
      ELEVENLABS_API_KEY: "sk_abc",
      PEXELS_API_KEY: "quoted",
      HEDRA_API_KEY: "single",
      SPACED_KEY: "padded",
    });
  });
});
