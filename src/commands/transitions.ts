import { describeTransition, listTransitionIds } from "../media/transitionLib.js";
import { WIPE_ANGLES, WIPE_DEFAULTS } from "../render/wipeSpec.js";
import { CAMERA_MOVES } from "../render/cameraSpec.js";
import { choiceLines, emitJson, wantsJson, type Choice } from "./emit.js";

// Discovery: what a beat handoff can be, and how to author a new one. Mirrors `kino backgrounds`.
//
// The built-in list is data so `--as json` carries which transition to REACH FOR, not just the
// names — "a cross-fade mushes two authored layouts" is the whole reason to pick a wipe.

export const BUILT_IN: Choice[] = [
  { label: "dissolve", ids: ["dissolve"], note: "noise-keyed cross-dissolve (DEFAULT for motion→motion)" },
  { label: "fade", ids: ["fade"], note: "straight cross-fade" },
  {
    label: "wipe-down / wipe-up / wipe-left / wipe-right",
    ids: ["wipe-down", "wipe-up", "wipe-left", "wipe-right"],
    note: "a lit edge travels across and UNCOVERS the incoming beat. Prefer this between two authored compositions — a cross-fade mushes the two layouts.",
  },
  { label: "wipe", ids: ["wipe"], note: "same shader, arbitrary angle via transitionParams.angle (diagonals)" },
  {
    label: "fly-left / fly-up / pop",
    ids: ["fly-left", "fly-up", "pop"],
    note: "punchy app-still entrances (auto-varied on `video` beats)",
  },
  { label: "cut", ids: ["cut"], note: "hard abut, no overlap" },
  { label: "custom", ids: ["custom"], note: "YOUR shader; pair with transitionSource" },
];

const WIPE_KNOBS = [
  {
    name: "angle",
    doc: `degrees of travel; ${Object.entries(WIPE_ANGLES)
      .filter(([k]) => k !== "wipe")
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")}`,
  },
  { name: "softness", doc: "reveal-edge feather, fraction of frame", default: WIPE_DEFAULTS.softness },
  { name: "edgeWidth", doc: "lit band width; 0 = unlit, clean reveal", default: WIPE_DEFAULTS.edgeWidth },
  { name: "edgeColor", doc: "hex (default: brand mint)" },
  { name: "edgeGain", doc: "lit band brightness; 0 = unlit", default: WIPE_DEFAULTS.edgeGain },
];

const CAMERA_KNOBS = [
  { name: "move", doc: Object.keys(CAMERA_MOVES).join(" | ") },
  { name: "zoom", doc: ">0 push in, <0 pull out" },
  { name: "panX / panY", doc: "fraction of the frame" },
  { name: "amount", doc: "scales the whole move" },
  { name: "blur", doc: "directional smear along the travel" },
  {
    name: "hold",
    doc: "0..0.95 (default .5) — fraction of each side HELD at full extent. This is what makes a push punch in and sit there rather than drift; 0 = continuous drift.",
  },
];

const SHADER_SCOPE = {
  "kinoFrom(uv) / kinoTo(uv)": "the two beats, already composited",
  "kinoUv(fragCoord)": "fragCoord → uv",
  uP: "0 at the first overlapping frame, 1 at the last",
  "uRes / iResolution": "framebuffer size",
  "uBrandBg / uBrandFg": "brand palette as rgb — the five roles brand.md names",
  "uBrandAccent / uBrandAccent2 / uBrandDeep": "…primary, secondary/bright, and deep fill",
  "kinoPick(u_x, fallback)": "THE COLOUR RULE — author's colour if set, else the fallback",
  "u_<name>": "each NUMERIC transitionParams key (up to 8)",
  "u_<name> (hex value)": "each COLOUR transitionParams key (up to 4), e.g. \"ink\": \"#ff00aa\"",
};

// Printed under the authoring block. This is the one convention an agent writing a shader is most
// likely to get wrong — hard-coding a hue is the path of least resistance and looks fine on the
// brand it was written against, then ships someone else's colour to every other brand.
const COLOUR_RULE = [
  "  COLOUR: never hard-code a hue for anything the shader PAINTS (ink, fire, an edge glow,",
  "  a bevel). Take it from the brand, and let the spec override it:",
  "",
  '      vec3 ink = kinoPick(u_ink, uBrandAccent);   // spec "ink":"#ff00aa" wins; else the brand',
  "",
  "  That one line covers all three cases: brand by default, per-spec override, and a literal",
  "  fallback for a colour that is physical rather than editorial (white-hot core, black char —",
  "  those stay literals, because they are not the brand's to choose).",
  "",
  "  Roles: uBrandAccent = primary  ·  uBrandAccent2 = secondary/bright (reads as heat)",
  "         uBrandDeep = deep fill  ·  uBrandBg / uBrandFg = page base / ink",
  "",
  "  Shipped examples: organic-inkbleed (u_ink/u_pool/u_stain), film-scorch (u_fire),",
  "  geo-facade (u_bevel). Each names the hex that restores its original look.",
];

const NOTES = [
  "Set `transition` on the INCOMING beat (video or motion).",
  "Reverse ANY transition — built-in or your own — with the sibling flag `transitionInvert: true`. Implemented in the compositor (swap the two beats, feed 1-p), so no shader knows it is being inverted and none of them can get it wrong.",
  "`transitionCamera` composes with any transition and with transitionInvert: the outgoing beat keeps moving as it leaves and the incoming arrives already in motion, so the cut reads as one shot.",
  "CONTRACT for a custom shader: exactly kinoFrom at uP=0 and exactly kinoTo at uP=1. A transition that is a hair off at either endpoint pops on every beat boundary. Copy assets-lib/transitions/iris.frag — it shows how to overshoot both ends on purpose.",
  "Motion beats are NOT in the app auto-vary rotation: they default to dissolve, and only change when the beat says so. `kino still --at <boundary> --montage` to check a handoff.",
];

export async function transitions(opts: { as?: string } = {}): Promise<void> {
  const lib = listTransitionIds();

  if (wantsJson(opts)) {
    emitJson({
      kind: "transitions",
      builtIn: BUILT_IN.map(({ ids, label, note }) => ({ ids, label, note })),
      ids: BUILT_IN.flatMap((c) => c.ids),
      library: lib.map((id) => ({ id, description: describeTransition(id) })),
      transitionParams: { wipe: WIPE_KNOBS },
      transitionCamera: { moves: Object.keys(CAMERA_MOVES), knobs: CAMERA_KNOBS },
      transitionInvert: "boolean sibling flag; reverses any transition",
      custom: {
        author: "a .frag in assets-lib/transitions/ or the project's assets/",
        spec: { transition: "custom", transitionSource: "iris", transitionParams: { softness: 0.04 } },
        entryPoint: "void mainImage(out vec4 fragColor, in vec2 fragCoord)",
        scope: SHADER_SCOPE,
      },
      notes: NOTES,
    });
    return;
  }

  const w = process.stdout.write.bind(process.stdout);
  w("Beat transitions — set `transition` on the INCOMING beat (video or motion).\n\n");

  w("  Built-in:\n");
  for (const c of BUILT_IN) w(choiceLines(c));
  w("\n");

  w("  Wipe knobs (transitionParams — all optional):\n");
  for (const k of WIPE_KNOBS) {
    const dflt = k.default !== undefined ? ` (default ${k.default})` : "";
    w(`    ${k.name.padEnd(10)} ${k.doc}${dflt}\n`);
  }
  w("\n");

  w("  Reverse ANY of them — built-in or your own — with a sibling flag:\n");
  w('    "transition": "wipe-down", "transitionInvert": true    // sweeps up, concealing instead\n');
  w('    "transition": "custom", "transitionSource": "iris",\n');
  w('    "transitionInvert": true                               // the iris closes instead of opens\n');
  w("    Implemented in the compositor (swap the two beats, feed 1-p), so no shader knows it is\n");
  w("    being inverted and none of them can get it wrong — endpoints survive by construction.\n\n");

  w("  Carry a CAMERA through the cut with `transitionCamera` — composes with any transition,\n");
  w("  built-in or your own, and with transitionInvert. The outgoing beat keeps moving as it\n");
  w("  leaves and the incoming arrives already in motion, so the cut reads as one shot:\n");
  for (const k of CAMERA_KNOBS) w(`    ${k.name.padEnd(12)} ${k.doc}\n`);
  w('    e.g. "transitionCamera": { "move": "whip-left" }   or  { "zoom": 0.2, "blur": 0 }\n\n');

  w("  Custom library (bare transitionSource ids):\n");
  if (lib.length) {
    const idw = Math.max(...lib.map((id) => id.length));
    for (const id of lib) {
      const desc = describeTransition(id);
      w(`    · ${id.padEnd(idw)}${desc ? `  ${desc}` : ""}\n`);
    }
  } else w("    · (empty assets-lib/transitions/)\n");
  w("\n");

  w("  Author your own — a .frag in assets-lib/transitions/ or the project's assets/:\n");
  w('    "transition": "custom",\n');
  w('    "transitionSource": "iris",                       // bare id, or "transitions/my.frag"\n');
  w('    "transitionParams": { "softness": 0.04 }          // NUMERIC keys → u_<name> uniforms\n\n');
  w("    Write a ShaderToy-style mainImage() — the same entry point background shaders use:\n\n");
  w("      void mainImage(out vec4 fragColor, in vec2 fragCoord) {\n");
  w("        vec2 uv = kinoUv(fragCoord);\n");
  w("        fragColor = mix(kinoFrom(uv), kinoTo(uv), step(uv.x, uP));\n");
  w("      }\n\n");
  w("    In scope: ");
  const scope = Object.entries(SHADER_SCOPE);
  // Width from the longest key rather than a literal, so adding a uniform can't silently break the
  // column the way the brand entries did.
  const kw = Math.max(...scope.map(([k]) => k.length));
  scope.forEach(([k, v], i) => w(`${i ? "              " : ""}${k.padEnd(kw)} — ${v}\n`));
  w("\n");
  w("    CONTRACT: exactly kinoFrom at uP=0 and exactly kinoTo at uP=1. A transition that is a\n");
  w("    hair off at either endpoint pops on every beat boundary. Copy assets-lib/transitions/\n");
  w("    iris.frag — it shows how to overshoot both ends on purpose.\n\n");
  COLOUR_RULE.forEach((l) => w(`  ${l}\n`));
  w("\n");
  w("  Motion beats are NOT in the app auto-vary rotation: they default to dissolve, and only\n");
  w("  change when the beat says so. `kino still --at <boundary> --montage` to check a handoff.\n");
}
