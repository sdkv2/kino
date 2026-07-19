import { describe, it, expect } from "vitest";
import { computeTimings } from "../src/vo/vo.js";

describe("computeTimings", () => {
  it("accumulates start/end offsets with a fixed gap", () => {
    const t = computeTimings([2.0, 3.0, 1.0], 0.32);
    expect(t[0]).toMatchObject({ index: 0, startSec: 0, endSec: 2.0 });
    expect(t[1]).toMatchObject({ index: 1, startSec: 2.32, endSec: 5.32 });
    expect(t[2]).toMatchObject({ index: 2, startSec: 5.64, endSec: 6.64 });
  });
});

import { stripTagWords } from "../src/vo/vo.js";
import { describe as d2, it as it2, expect as ex2 } from "vitest";

d2("stripTagWords", () => {
  it2("drops single and multiword bracket tags, keeps real words and their timings", () => {
    const w = (word: string, i: number) => ({ word, start: i, end: i + 1 });
    const words = ["[excited]", "Hello", "world.", "[short", "pause]", "Bye."].map(w);
    ex2(stripTagWords(words).map((x) => x.word)).toEqual(["Hello", "world.", "Bye."]);
    ex2(stripTagWords(words)[0].start).toBe(1);
  });
});
