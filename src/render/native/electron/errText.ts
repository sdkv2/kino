/**
 * Render an unknown thrown value as text a human can act on.
 *
 * `String(err)` is not enough at the Electron boundaries. `webContents.executeJavaScript` settles
 * its rejection through structured clone, which does not carry the Error prototype: the page throws
 * a real Error, the main process receives a plain object, `(e as Error).stack` is `undefined`, and
 * `String(e)` prints the useless `[object Object]`. Same for anything thrown across an IPC hop.
 *
 * So: prefer a stack, then a message, then own-property JSON — and only fall back to `String` for
 * primitives, where it is actually informative.
 */
export function errText(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack;
    if (stack && stack.includes(err.message)) return stack;
    const head = `${err.name}: ${err.message}`;
    return stack ? `${head}\n${stack}` : head;
  }
  if (typeof err === "string") return err || "(empty string thrown)";
  if (err !== null && typeof err === "object") {
    const o = err as { stack?: unknown; message?: unknown; name?: unknown };
    if (typeof o.stack === "string" && o.stack.trim()) return o.stack;
    if (typeof o.message === "string" && o.message.trim()) {
      const name = typeof o.name === "string" && o.name ? `${o.name}: ` : "";
      return `${name}${o.message}`;
    }
    try {
      // Own properties: a cloned DOMException/Error keeps name/message/code as own props, and a
      // plain `{}` from a stripped clone at least prints as `{}` rather than `[object Object]`.
      const json = JSON.stringify(err, Object.getOwnPropertyNames(err));
      if (json) return json;
    } catch {
      // circular or non-serialisable — fall through
    }
    // Never `Object.prototype.toString` here: that is the "[object Object]" this module exists to
    // stop. Name the shape instead, which at least says what came back.
    const tag = Object.prototype.toString.call(err).slice(8, -1);
    return `<unserialisable ${tag} keys=[${Object.getOwnPropertyNames(err).join(",")}]>`;
  }
  return String(err);
}

/**
 * The same logic as an expression, for inlining into `executeJavaScript` source.
 *
 * The stringification has to happen *inside the page*, while the Error is still an Error — once
 * Electron has cloned it across the boundary the stack and prototype are already gone.
 */
export const ERR_TEXT_JS = `((e) => {
  if (e instanceof Error) return e.stack || (e.name + ": " + e.message);
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    if (typeof e.stack === "string" && e.stack) return e.stack;
    if (typeof e.message === "string" && e.message) return (e.name ? e.name + ": " : "") + e.message;
    try { const j = JSON.stringify(e, Object.getOwnPropertyNames(e)); if (j) return j; } catch (_) {}
    return "<unserialisable keys=[" + Object.getOwnPropertyNames(e).join(",") + "]>";
  }
  return String(e);
})`;
