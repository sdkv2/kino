// Generates short, transparent, marksman/reticle Lottie "burst" assets for the word-fire flex.
// Thin black strokes + a single signal-red accent on a flat cream frame — crosshair, target, corner
// brackets, red-dot. One layer; position/scale/rotation/opacity live on the LAYER transform, the shape
// groups carry only their offset (identity scale) to avoid the double-offset gotcha. Pure Bodymovin —
// no images/fonts/expressions, so it passes kino's Lottie lint. Run from the project dir:
//   node assets/gen-bursts.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "motion");
mkdirSync(outDir, { recursive: true });

const INK = "#16130D";
const RED = "#C8401F";

const rgba = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const bez = (xi = 0.3, xo = 0.4) => ({ i: { x: [xi], y: [1] }, o: { x: [xo], y: [0] } });
const fill = (hex) => ({ ty: "fl", c: { a: 0, k: rgba(hex) }, o: { a: 0, k: 100 } });
const stroke = (hex, w) => ({ ty: "st", c: { a: 0, k: rgba(hex) }, o: { a: 0, k: 100 }, w: { a: 0, k: w }, lc: 2, lj: 2 });
const tr = (x = 0, y = 0, rot = 0) => ({ ty: "tr", p: { a: 0, k: [x, y] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: rot }, o: { a: 0, k: 100 } });
const rect = (w, h, x, y, paint, rot = 0) => ({ ty: "gr", it: [{ ty: "rc", d: 1, s: { a: 0, k: [w, h] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }, paint, tr(x, y, rot)] });
const ring = (d, x, y, paint) => ({ ty: "gr", it: [{ ty: "el", d: 1, s: { a: 0, k: [d, d] }, p: { a: 0, k: [0, 0] } }, paint, tr(x, y)] });

// Layer transforms.
const fadeOut = (op, holdTo) => ({ a: 1, k: [{ t: 0, s: [100], ...bez() }, { t: holdTo, s: [100], ...bez() }, { t: op, s: [0] }] });
const popScale = () => ({ a: 1, k: [{ t: 0, s: [0, 0, 100], ...bez(0.2, 0.3) }, { t: 7, s: [114, 114, 100], ...bez(0.4, 0.5) }, { t: 12, s: [100, 100, 100] }] });
const snapIn = () => ({ a: 1, k: [{ t: 0, s: [150, 150, 100], ...bez(0.1, 0.3) }, { t: 8, s: [96, 96, 100], ...bez(0.4, 0.5) }, { t: 13, s: [100, 100, 100] }] });
const expand = (op) => ({ a: 1, k: [{ t: 0, s: [35, 35, 100], ...bez(0.1, 0.3) }, { t: op, s: [120, 120, 100] }] });
const rotIn = (deg, op) => ({ a: 1, k: [{ t: 0, s: [deg], ...bez(0.2, 0.4) }, { t: Math.round(op * 0.65), s: [0] }] });

const layer = (op, shapes, scaleKf, rKf) => ({
  ddd: 0, ind: 1, ty: 4, nm: "reticle", sr: 1,
  ks: { o: fadeOut(op, Math.round(op * 0.5)), r: rKf ?? { a: 0, k: 0 }, p: { a: 0, k: [540, 960, 0] }, a: { a: 0, k: [0, 0, 0] }, s: scaleKf },
  ao: 0, shapes, ip: 0, op, st: 0, bm: 0,
});
const doc = (nm, op, lyr) => ({ v: "5.7.4", fr: 30, ip: 0, op, w: 1080, h: 1920, nm, ddd: 0, assets: [], layers: [lyr] });

// — crosshair: four ink ticks + a red center dot, pops in with a slight rotate.
const crosshair = (() => {
  const t = 8, len = 110, off = 150;
  const shapes = [
    rect(t, len, 0, -off, fill(INK)), rect(t, len, 0, off, fill(INK)),
    rect(len, t, -off, 0, fill(INK)), rect(len, t, off, 0, fill(INK)),
    ring(40, 0, 0, fill(RED)),
  ];
  return doc("crosshair", 13, layer(13, shapes, popScale(), rotIn(14, 13)));
})();

// — target: concentric rings (red inner) + four edge ticks, expands outward.
const target = (() => {
  const shapes = [
    ring(560, 0, 0, stroke(INK, 8)), ring(380, 0, 0, stroke(INK, 7)), ring(180, 0, 0, stroke(RED, 11)),
    rect(6, 92, 0, -300, fill(INK)), rect(6, 92, 0, 300, fill(INK)),
    rect(92, 6, -300, 0, fill(INK)), rect(92, 6, 300, 0, fill(INK)),
    ring(22, 0, 0, fill(RED)),
  ];
  return doc("target", 16, layer(16, shapes, expand(16)));
})();

// — brackets: four ink corner L's snapping inward (the logo's registration marks, as a burst).
const brackets = (() => {
  const half = 300, arm = 96, t = 9;
  const corner = (sx, sy) => [
    rect(arm, t, sx * (half - arm / 2), sy * half, fill(INK)),
    rect(t, arm, sx * half, sy * (half - arm / 2), fill(INK)),
  ];
  const shapes = [...corner(-1, -1), ...corner(1, -1), ...corner(-1, 1), ...corner(1, 1)];
  return doc("brackets", 14, layer(14, shapes, snapIn()));
})();

// — reddot: a red dot + an ink ring, quick pop (the signal accent).
const reddot = (() => {
  const shapes = [ring(190, 0, 0, stroke(INK, 6)), ring(96, 0, 0, fill(RED))];
  return doc("reddot", 12, layer(12, shapes, popScale()));
})();

const assets = { "crosshair.json": crosshair, "target.json": target, "brackets.json": brackets, "reddot.json": reddot };
for (const [name, json] of Object.entries(assets)) {
  writeFileSync(join(outDir, name), JSON.stringify(json, null, 1) + "\n");
  console.log("wrote", name);
}
