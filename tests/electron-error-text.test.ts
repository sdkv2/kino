import { describe, it, expect } from "vitest";
import { errText, ERR_TEXT_JS } from "../src/render/native/electron/errText.js";

// The whole point of this helper: `String(err)` on anything that is not an Error prints
// "[object Object]", and Electron's executeJavaScript settles rejections through structured clone,
// which strips the Error prototype. A Linux `direct`-capture failure spent three worker restarts
// reporting nothing but "[object Object]" because of exactly that.
describe("errText", () => {
  it("never renders an object as [object Object]", () => {
    for (const v of [{}, { code: 5 }, { name: "X" }, Object.create(null) as object]) {
      expect(errText(v)).not.toBe("[object Object]");
    }
  });

  it("prefers a stack, then a message, on a prototype-stripped clone", () => {
    expect(errText({ stack: "Error: boom\n  at x" })).toContain("at x");
    expect(errText({ message: "boom" })).toBe("boom");
    expect(errText({ name: "OperationError", message: "Encoder creation error." })).toBe(
      "OperationError: Encoder creation error.",
    );
  });

  it("keeps the stack for a real Error", () => {
    const e = new Error("kaboom");
    expect(errText(e)).toContain("kaboom");
    expect(errText(e)).toContain("electron-error-text.test");
  });

  it("falls back to own-property JSON when there is no message or stack", () => {
    expect(errText({ code: 42, detail: "nope" })).toBe('{"code":42,"detail":"nope"}');
  });

  it("survives a circular object", () => {
    const o: Record<string, unknown> = { a: 1 };
    o.self = o;
    expect(() => errText(o)).not.toThrow();
    expect(errText(o)).not.toBe("[object Object]");
  });

  it("still reports primitives usefully", () => {
    expect(errText("plain string")).toBe("plain string");
    expect(errText(null)).toBe("null");
    expect(errText(undefined)).toBe("undefined");
    expect(errText(7)).toBe("7");
  });
});

// ERR_TEXT_JS is inlined into executeJavaScript so the stringification happens in the page, while
// the Error is still an Error. It has to agree with the node-side helper.
describe("ERR_TEXT_JS (inlined into the page)", () => {
  const inPage = eval(ERR_TEXT_JS) as (e: unknown) => string;

  it("matches errText on the cases that mattered", () => {
    expect(inPage({})).not.toBe("[object Object]");
    expect(inPage({ message: "boom" })).toContain("boom");
    expect(inPage(new Error("kaboom"))).toContain("kaboom");
    expect(inPage("plain string")).toBe("plain string");
    expect(inPage(undefined)).toBe("undefined");
  });

  it("names a DOMException-shaped clone", () => {
    expect(inPage({ name: "OperationError", message: "Encoder creation error." })).toBe(
      "OperationError: Encoder creation error.",
    );
  });
});
