import { describe, it, expect, beforeEach } from "vitest";
import { READBACK_HELPERS_JS, syncReadbackEnabled } from "../src/render/native/electron/readbackJs.js";

/** Minimal WebGL2 stand-in that records the call sequence. The helpers are page source, so the only
 *  way to test them off-Electron is to evaluate them against a fake `gl`/`window` — which is also
 *  the only way to assert the buffer-reuse and rebind behaviour that a real render would only
 *  reveal as corrupted pixels. */
function fakeGl() {
  const calls: string[] = [];
  let nextBuf = 1;
  const deleted: unknown[] = [];
  return {
    calls,
    deleted,
    RGBA: "RGBA",
    UNSIGNED_BYTE: "UNSIGNED_BYTE",
    PIXEL_PACK_BUFFER: "PIXEL_PACK_BUFFER",
    STREAM_READ: "STREAM_READ",
    createBuffer: () => {
      calls.push("createBuffer");
      return { id: nextBuf++ };
    },
    deleteBuffer: (b: unknown) => {
      calls.push("deleteBuffer");
      deleted.push(b);
    },
    bindBuffer: (_t: string, b: unknown) => calls.push(`bindBuffer:${b === null ? "null" : "pbo"}`),
    bufferData: () => calls.push("bufferData"),
    readPixels: (_x: number, _y: number, _w: number, _h: number, _f: string, _t: string, dst: unknown) =>
      calls.push(typeof dst === "number" ? "readPixels:offset" : "readPixels:array"),
    getBufferSubData: (_t: string, _o: number, dst: Uint8Array) => {
      calls.push("getBufferSubData");
      dst.fill(7); // stand in for real pixels, so callers can prove they got the shared array
    },
  };
}

/** Evaluate the injected helpers and hand back the two transports bound to a fresh fake page. */
function loadHelpers() {
  const win: Record<string, unknown> = {};
  const factory = new Function(
    "window",
    `${READBACK_HELPERS_JS}\nreturn { syncRead, pboRead };`,
  ) as (w: unknown) => {
    syncRead: (gl: unknown, w: number, h: number) => Uint8Array;
    pboRead: (gl: unknown, w: number, h: number) => Uint8Array;
  };
  return { win, ...factory(win) };
}

describe("readback pixel transport", () => {
  let gl: ReturnType<typeof fakeGl>;
  beforeEach(() => {
    gl = fakeGl();
  });

  it("pboRead reads via the PBO offset form, not a blocking copy into a JS array", () => {
    const { pboRead } = loadHelpers();
    pboRead(gl, 4, 2);
    // The offset form is the whole point: the array form is the synchronous command-buffer
    // round trip this path exists to avoid.
    expect(gl.calls).toContain("readPixels:offset");
    expect(gl.calls).not.toContain("readPixels:array");
    expect(gl.calls).toContain("getBufferSubData");
  });

  it("unbinds PIXEL_PACK_BUFFER afterwards so later page readPixels aren't redirected into it", () => {
    const { pboRead } = loadHelpers();
    pboRead(gl, 4, 2);
    expect(gl.calls.at(-1)).toBe("bindBuffer:null");
  });

  it("reuses one buffer and one destination array across frames of the same size", () => {
    const { pboRead } = loadHelpers();
    const a = pboRead(gl, 4, 2);
    const b = pboRead(gl, 4, 2);
    expect(b).toBe(a); // same array identity — no 8.3MB allocation per frame
    expect(gl.calls.filter((c) => c === "createBuffer")).toHaveLength(1);
    expect(gl.calls.filter((c) => c === "bufferData")).toHaveLength(1);
    expect(gl.deleted).toHaveLength(0);
  });

  it("returns the array the fetch actually wrote into", () => {
    const { pboRead } = loadHelpers();
    const out = pboRead(gl, 4, 2);
    expect(out).toHaveLength(4 * 2 * 4);
    expect([...out.slice(0, 4)]).toEqual([7, 7, 7, 7]);
  });

  it("reallocates and frees the old buffer when the canvas size changes mid-run", () => {
    const { pboRead } = loadHelpers();
    const small = pboRead(gl, 4, 2);
    const big = pboRead(gl, 8, 4);
    // A stale buffer would be the wrong length for getBufferSubData and throw on every later frame.
    expect(big).not.toBe(small);
    expect(big).toHaveLength(8 * 4 * 4);
    expect(gl.deleted).toHaveLength(1);
    expect(gl.calls.filter((c) => c === "createBuffer")).toHaveLength(2);
  });

  it("rebuilds on a new GL context at the same size, rather than reusing a dead handle", () => {
    const { pboRead } = loadHelpers();
    const first = pboRead(gl, 4, 2);
    const restored = fakeGl(); // same canvas size, context lost and recreated
    const second = pboRead(restored, 4, 2);
    expect(second).not.toBe(first);
    expect(restored.calls.filter((c) => c === "createBuffer")).toHaveLength(1);
    // The old buffer belongs to the dead context — deleting it through the new one is invalid.
    expect(restored.deleted).toHaveLength(0);
  });

  it("keeps per-page state on window, so concurrent worker pages cannot share a buffer", () => {
    const one = loadHelpers();
    const two = loadHelpers();
    const a = one.pboRead(gl, 4, 2);
    const b = two.pboRead(gl, 4, 2);
    expect(b).not.toBe(a);
    expect(one.win.__kinoRb).toBeDefined();
  });

  it("syncRead keeps the old array form, so KINO_RB_SYNC is a real A/B and not a relabel", () => {
    const { syncRead } = loadHelpers();
    syncRead(gl, 4, 2);
    expect(gl.calls).toEqual(["readPixels:array"]);
  });

  it("defaults to the PBO transport and only reverts on an explicit KINO_RB_SYNC=1", () => {
    expect(syncReadbackEnabled({})).toBe(false);
    expect(syncReadbackEnabled({ KINO_RB_SYNC: "0" })).toBe(false);
    expect(syncReadbackEnabled({ KINO_RB_SYNC: "1" })).toBe(true);
  });
});
