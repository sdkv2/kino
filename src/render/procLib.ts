// Tier-2 proc standard library: the `env.lib` namespace handed to every render(env). All three
// libraries are pure — the one impurity (simplex-noise's Math.random default seed) is closed off
// by always seeding from a fixed deterministic PRNG, so the same spec renders the same frames on
// every machine. Like sanitizeMotion, this runs BOTH browser-side (bundled into page.bundle.js,
// attached in motionFrameState) AND node-side (`kino still --dump-html` evaluates the same proc
// with the same env) — which is why the three libraries are runtime dependencies, not devDeps.
// Procs never import anything.
import * as shape from "d3-shape";
import * as color from "culori";
import { createNoise2D, createNoise3D, createNoise4D } from "simplex-noise";
import type { ProcLib, ProcNoiseSet } from "./props.js";

// xmur3 string hash → mulberry32 PRNG: tiny, seedable, and stable across platforms.
function mulberry32(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedNoise(seed: string | number): ProcNoiseSet {
  const key = String(seed);
  return Object.freeze({
    noise2D: createNoise2D(mulberry32(key)),
    noise3D: createNoise3D(mulberry32(key)),
    noise4D: createNoise4D(mulberry32(key)),
  });
}

const defaults = seedNoise("kino");

export const procLib: ProcLib = Object.freeze({
  shape,
  color,
  noise2D: defaults.noise2D,
  noise3D: defaults.noise3D,
  noise4D: defaults.noise4D,
  seedNoise,
});
