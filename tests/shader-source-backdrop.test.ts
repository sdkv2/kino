// @vitest-environment jsdom
// Finding 1: createShaderSource's prepare() unconditionally called registerBackdrop, so a declared
// shader layer (registry.ts's declared-layer loop) republished the glass backdrop bus mid-batch —
// Stage.tsx prepares the real backdrop first and awaits it, then fires every layer's prepare() in
// one Promise.all (Stage.tsx:56-74), so a declared shader layer's own prepare() would null out the
// compositor's already-registered backdropTexture (backdrop.ts's registerBackdrop always resets
// backdropTexture to null) before a kino-lens motion layer in the same batch reads
// peekBackdropTexture() — falling off the true-composite path onto the declared layer's own raw
// canvas instead. This exercises createShaderSource + backdrop.ts directly (no GL/WebGL needed:
// prepare() only calls the caller-supplied drawFrame and, conditionally, registerBackdrop — a
// bare <canvas> under jsdom is enough, matching how canvas2d's own publishBackdrop is otherwise
// covered: no pixel test exists for it either, see task-7-fix-report.md finding 1).
import { describe, it, expect, beforeEach } from "vitest";
import { createShaderSource } from "../src/render/native/page/compositor/providers/shader.js";
import {
  clearBackdrop,
  peekBackdrop,
  peekBackdropTexture,
  registerBackdropTexture,
} from "../src/render/native/page/backdrop.js";

const src = (publishBackdrop?: boolean) =>
  createShaderSource({
    drawFrame: () => {}, // no real GL needed — prepare() just calls this and (maybe) registerBackdrop
    width: 8,
    height: 8,
    params: {},
    keyframes: [],
    triggers: [],
    ...(publishBackdrop !== undefined ? { publishBackdrop } : {}),
  });

describe("createShaderSource backdrop bus", () => {
  beforeEach(() => clearBackdrop());

  it("publishes the backdrop by default — the real backdrop shader's unchanged behaviour", async () => {
    expect(peekBackdrop()).toBeNull();
    await src().prepare(0);
    expect(peekBackdrop()).not.toBeNull();
  });

  it("does not publish the backdrop when publishBackdrop is false — a declared shader layer", async () => {
    await src(false).prepare(0);
    expect(peekBackdrop()).toBeNull();
  });

  it("does not null the compositor's registered backdropTexture — the actual lens regression", async () => {
    // Mirrors the real pipeline: the compositor registers the true GPU composite for this frame...
    registerBackdropTexture({} as WebGLTexture, 8, 8);
    expect(peekBackdropTexture()).not.toBeNull();

    // ...then a declared shader layer prepares in the same Promise.all batch as a kino-lens layer.
    await src(false).prepare(0);

    // A kino-lens layer preparing alongside it must still find the true composite.
    expect(peekBackdropTexture()).not.toBeNull();
    expect(peekBackdrop()).toBeNull();
  });

  it("WOULD null the registered backdropTexture without the fix (publishBackdrop defaulting true) — the bug this closes", async () => {
    registerBackdropTexture({} as WebGLTexture, 8, 8);
    expect(peekBackdropTexture()).not.toBeNull();

    // Same shape as the declared-layer call above, but without opting out — i.e. registry.ts's
    // declared-shader branch before this fix.
    await src().prepare(0);

    expect(peekBackdropTexture()).toBeNull(); // clobbered
    expect(peekBackdrop()).not.toBeNull(); // republished with the declared layer's own raw canvas
  });
});
