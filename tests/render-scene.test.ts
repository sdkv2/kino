import { describe, it, expect } from "vitest";
import { renderStills } from "../src/render/render.js";
import { magick } from "./magick.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { KinoProps } from "../src/render/props.js";

const theme = { font: "Arial", night: "#0b1020", mint: "#80e2b4", green: "#0c8d64", gold: "#d99a20", white: "#fff", captionFontSize: 74, captionStroke: 9 };
const bg = { kind: "solid" as const, image: null, customCode: null, params: {}, keyframes: [], triggers: [] };

// Full-frame mint box: at fov 40 with the camera dollied to z≈2.5–2.7, an 8×8 plane overfills the
// frame, so the centre pixel reads the box. Mint (#80e2b4) tone-maps to a bright green-dominant
// pixel; the solid backdrop is dark blue-dominant (srgb(23,28,43)) — so a green-dominant, bright
// centre can ONLY mean the WebGL canvas drew and composited over the backdrop.
const scene = `const b = api.box({ size: [8, 8, 0.1], material: api.basic({ color: "mint" }) });
const cam = api.camera({ fov: 40 });
return (env) => { cam.dolly(3 - env.progress); };`;

const props = (): KinoProps => ({
  theme, fps: 30, avatar: null, avatarWindows: [], voTrack: null, logo: null, background: bg,
  disclosure: "test",
  segments: [
    { kind: "motion", caption: "", startSec: 0, endSec: 2,
      motion: { html: "", scene, sceneAssets: [], params: {}, keyframes: [], triggers: [] } },
  ],
});

const center = (png: string) => magick([png, "-format", "%[pixel:p{540,960}]", "info:"]).trim();
const sampleAt = (png: string, x: number, y: number) => magick([png, "-format", `%[pixel:p{${x},${y}}]`, "info:"]).trim();
const rgb = (s: string) => {
  const m = s.match(/srgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) throw new Error(`Unexpected pixel format: ${s}`);
  return { r: +m[1], g: +m[2], b: +m[3] };
};
// The mint box composited: bright + green-dominant. The dark, blue-dominant backdrop cannot pass.
const expectMint = (px: string) => {
  const { r, g, b } = rgb(px);
  expect(g).toBeGreaterThan(180); // backdrop g≈28 — a bright green channel means the box drew
  expect(g).toBeGreaterThan(r);   // mint is green-dominant; the backdrop is blue-dominant (b>g)
  expect(g).toBeGreaterThan(b);
  expect(r).toBeGreaterThan(100); // light mint, not a dark fallback
};
const sha = (p: string) => createHash("sha1").update(readFileSync(p)).digest("hex");

describe("3d scene render", () => {
  it("draws the scene into the composited frame", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-3d-"));
    const outs = await renderStills({ props: props(), publicDir: outDir, format: "9:16", frames: [{ frame: 30, name: "s" }], outDir });
    expect(outs).toHaveLength(1);
    expectMint(center(outs[0])); // not the night backdrop → WebGL canvas composited
  }, 240000);

  it("is deterministic run-to-run on this machine", async () => {
    const a = mkdtempSync(join(tmpdir(), "kino-3da-"));
    const b = mkdtempSync(join(tmpdir(), "kino-3db-"));
    const [ra] = await renderStills({ props: props(), publicDir: a, format: "9:16", frames: [{ frame: 17, name: "d" }], outDir: a });
    const [rb] = await renderStills({ props: props(), publicDir: b, format: "9:16", frames: [{ frame: 17, name: "d" }], outDir: b });
    expectMint(center(ra));      // the frame under test actually contains the scene (not a vacuous blank match)
    expect(sha(ra)).toBe(sha(rb)); // byte-identical PNG across separate renders → seeded/settled render is stable
  }, 240000);

  it("renders a scene as motionOverlay on an avatar beat", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kino-3do-"));
    const p = props();
    p.segments = [{ kind: "avatar", caption: "hook", startSec: 0, endSec: 2,
      motionOverlay: { html: "", scene, sceneAssets: [], params: {}, keyframes: [], triggers: [] } }];
    const outs = await renderStills({ props: p, publicDir: outDir, format: "9:16", frames: [{ frame: 20, name: "o" }], outDir });
    expect(outs).toHaveLength(1);
    // The box overfills the frame, so any point reads mint — but a hero caption covers the centre on a
    // faceless avatar beat, so sample an off-centre point the caption never touches.
    expectMint(sampleAt(outs[0], 150, 300)); // the overlay scene composited over the avatar beat
  }, 240000);
});
