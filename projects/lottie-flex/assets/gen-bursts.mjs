// Generates short, transparent, on-brand Lottie "burst" assets for the word-fire flex.
// Each is a single shape on one layer; position + scale + opacity live on the LAYER transform and the
// group transform is identity (avoids the double-offset gotcha). Pure Bodymovin — no images, fonts, or
// expressions, so it passes kino's Lottie lint. Run: `node assets/gen-bursts.mjs` from the project dir.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "motion");
mkdirSync(outDir, { recursive: true });

const rgba = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
};
const bez = (xi = 0.3, xo = 0.4) => ({ i: { x: [xi], y: [1] }, o: { x: [xo], y: [0] } });

const doc = (nm, op, layer) => ({ v: "5.7.4", fr: 30, ip: 0, op, w: 1080, h: 1920, nm, ddd: 0, assets: [], layers: [layer] });

const layer = (op, scaleKf, opacityKf, shapeItems) => ({
  ddd: 0, ind: 1, ty: 4, nm: "burst", sr: 1,
  ks: {
    o: opacityKf,
    r: { a: 0, k: 0 },
    p: { a: 0, k: [540, 960, 0] },
    a: { a: 0, k: [0, 0, 0] },
    s: scaleKf,
  },
  ao: 0,
  shapes: [{ ty: "gr", it: [...shapeItems, { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }],
  ip: 0, op, st: 0, bm: 0,
});

const ellipse = (d) => ({ ty: "el", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [d, d] } });
const fill = (hex) => ({ ty: "fl", c: { a: 0, k: rgba(hex) }, o: { a: 0, k: 100 } });
const stroke = (hex, w) => ({ ty: "st", c: { a: 0, k: rgba(hex) }, o: { a: 0, k: 100 }, w: { a: 0, k: w }, lc: 2, lj: 2 });

// Overshoot pop: 0 → 115% → 100% over ~0.4s.
const popScale = () => ({ a: 1, k: [
  { t: 0, s: [0, 0, 100], ...bez(0.2, 0.3) },
  { t: 7, s: [115, 115, 100], ...bez(0.4, 0.5) },
  { t: 12, s: [100, 100, 100] },
] });
// Ring expands outward.
const ringScale = (op) => ({ a: 1, k: [
  { t: 0, s: [25, 25, 100], ...bez(0.1, 0.3) },
  { t: op, s: [160, 160, 100] },
] });
// Hold, then fade out over the tail.
const fadeOut = (op, holdTo) => ({ a: 1, k: [
  { t: 0, s: [100], ...bez() },
  { t: holdTo, s: [100], ...bez() },
  { t: op, s: [0] },
] });

const assets = {
  "pop-mint.json": doc("pop-mint", 14, layer(14, popScale(), fadeOut(14, 9), [ellipse(540), fill("#80e2b4")])),
  "pop-green.json": doc("pop-green", 14, layer(14, popScale(), fadeOut(14, 9), [ellipse(540), fill("#0c8d64")])),
  "ring-gold.json": doc("ring-gold", 16, layer(16, ringScale(16), fadeOut(16, 4), [ellipse(360), stroke("#d99a20", 46)])),
  "spark-white.json": doc("spark-white", 11, layer(11, popScale(), fadeOut(11, 5), [ellipse(220), fill("#ffffff")])),
};

for (const [name, json] of Object.entries(assets)) {
  writeFileSync(join(outDir, name), JSON.stringify(json, null, 1) + "\n");
  console.log("wrote", name);
}
