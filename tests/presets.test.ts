import { describe, it, expect } from "vitest";
import { getPreset, PRESET_NAMES } from "../src/render/remotion/backgrounds/presets.js";
import type { DrawEnv } from "../src/render/remotion/backgrounds/presets.js";

// A fake 2D context that records every call/assignment as a string, so we can assert a draw
// is a pure function of its env (determinism is required for frame-by-frame Remotion capture).
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

const env = (frame: number): DrawEnv => ({ frame, fps: 30, width: 1080, height: 1920, colors: ["#80e2b4", "#0c8d64", "#d99a20"], intensity: 0.5 });

describe("background presets", () => {
  it("exposes a draw fn for every named preset and nothing else", () => {
    for (const name of PRESET_NAMES) expect(typeof getPreset(name)).toBe("function");
    expect(getPreset("does-not-exist")).toBeUndefined();
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
});
