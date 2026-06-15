import { describe, it, expect } from "vitest";
import { isAvatarIV, pickPhotoLooks } from "../src/avatar/heygen.js";

describe("Avatar-IV guard", () => {
  it("accepts looks whose engines include avatar_iv", () => {
    expect(isAvatarIV({ supported_api_engines: ["avatar_v", "avatar_iv"] })).toBe(true);
    expect(isAvatarIV({ supported_api_engines: ["studio"] })).toBe(false);
  });
  it("filters a looks list to portrait Avatar-IV looks", () => {
    const looks = [
      { id: "a", gender: "male", preferred_orientation: "portrait", supported_api_engines: ["avatar_iv"] },
      { id: "b", gender: "male", preferred_orientation: "landscape", supported_api_engines: ["avatar_iv"] },
      { id: "c", gender: "male", preferred_orientation: "portrait", supported_api_engines: ["studio"] },
    ];
    expect(pickPhotoLooks(looks).map((l) => l.id)).toEqual(["a"]);
  });
});
