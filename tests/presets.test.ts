import { describe, it, expect } from "vitest";
import { getPreset, PRESET_NAMES } from "../src/render/backgrounds/presets.js";
import type { DrawEnv } from "../src/render/backgrounds/presets.js";
import { PRESET_SCHEMAS } from "../src/render/backgroundSchema.js";

// A fake 2D context that records every call/assignment as a string, so we can assert a draw
// is a pure function of its env (determinism is required for frame-by-frame capture).
function recordCtx() {
  const log: string[] = [];
  const num = (x: unknown) => (typeof x === "number" ? Math.round(x * 100) / 100 : String(x));
  const grad = { addColorStop: (...a: unknown[]) => log.push(`stop(${a.map(num).join(",")})`) };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        const p = String(prop);
        if (p === "createLinearGradient" || p === "createRadialGradient") {
          return (...a: unknown[]) => {
            log.push(`${p}(${a.map(num).join(",")})`);
            return grad;
          };
        }
        return (...a: unknown[]) => log.push(`${p}(${a.map(num).join(",")})`);
      },
      set(_t, prop, val) {
        log.push(`${String(prop)}=${String(val)}`);
        return true;
      },
    },
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { ctx: ctx as any, log };
}

const env = (frame: number): DrawEnv => ({
  frame,
  fps: 30,
  width: 1080,
  height: 1920,
  params: { colorA: "#80e2b4", colorB: "#0c8d64", colorC: "#d99a20", intensity: 0.5 },
  pulse: 0,
});

describe("background presets", () => {
  it("exposes a draw fn for every named preset and nothing else", () => {
    for (const name of PRESET_NAMES) expect(typeof getPreset(name)).toBe("function");
    expect(getPreset("does-not-exist")).toBeUndefined();
  });
  it("publishes a discoverable param/action schema for each preset", () => {
    for (const name of PRESET_NAMES) {
      const s = PRESET_SCHEMAS[name];
      expect(s.params.length).toBeGreaterThan(0);
      expect(s.actions).toContain("pulse");
      expect(s.params.map((p) => p.name)).toContain("intensity");
    }
  });

  for (const name of ["mesh", "aurora", "particles", "grid"]) {
    it(`${name} is a pure, frame-driven function`, () => {
      const draw = getPreset(name)!;
      const a = recordCtx();
      const b = recordCtx();
      draw(a.ctx, env(30));
      draw(b.ctx, env(30));
      expect(a.log).toEqual(b.log); // same frame → identical ops (deterministic)
      expect(a.log.length).toBeGreaterThan(0);

      const c = recordCtx();
      draw(c.ctx, env(75));
      expect(c.log).not.toEqual(a.log); // different frame → it actually animates
    });
  }

  it("solid is frame-INDEPENDENT (loop-safe: no drift on the global frame across a seam)", () => {
    const draw = getPreset("solid")!;
    const a = recordCtx();
    const b = recordCtx();
    draw(a.ctx, env(30));
    draw(b.ctx, env(75)); // a different frame
    expect(a.log).toEqual(b.log); // identical ops regardless of frame → static
    expect(a.log.length).toBeGreaterThan(0);
  });
});
