import { listTransitionIds } from "../media/transitionLib.js";
import { WIPE_ANGLES, WIPE_DEFAULTS } from "../render/wipeSpec.js";
import { CAMERA_MOVES } from "../render/cameraSpec.js";

// Discovery: what a beat handoff can be, and how to author a new one. Mirrors `kino backgrounds`.
export async function transitions(): Promise<void> {
  const w = process.stdout.write.bind(process.stdout);
  w("Beat transitions — set `transition` on the INCOMING beat (video or motion).\n\n");

  w("  Built-in:\n");
  w("    · dissolve   — noise-keyed cross-dissolve (DEFAULT for motion→motion)\n");
  w("    · fade       — straight cross-fade\n");
  w("    · wipe-down / wipe-up / wipe-left / wipe-right\n");
  w("                   a lit edge travels across and UNCOVERS the incoming beat. Prefer this\n");
  w("                   between two authored compositions — a cross-fade mushes the two layouts.\n");
  w("    · wipe       — same shader, arbitrary angle via transitionParams.angle (diagonals)\n");
  w("    · fly-left / fly-up / pop  — punchy app-still entrances (auto-varied on `video` beats)\n");
  w("    · cut        — hard abut, no overlap\n");
  w("    · custom     — YOUR shader; pair with transitionSource\n\n");

  w("  Wipe knobs (transitionParams — all optional):\n");
  w(`    angle      degrees of travel; ${Object.entries(WIPE_ANGLES)
    .filter(([k]) => k !== "wipe")
    .map(([k, v]) => `${k}=${v}`)
    .join(" ")}\n`);
  w(`    softness   reveal-edge feather, fraction of frame (default ${WIPE_DEFAULTS.softness})\n`);
  w(`    edgeWidth  lit band width (default ${WIPE_DEFAULTS.edgeWidth}); 0 = unlit, clean reveal\n`);
  w("    edgeColor  hex (default: brand mint)\n");
  w(`    edgeGain   lit band brightness (default ${WIPE_DEFAULTS.edgeGain}); 0 = unlit\n\n`);

  w("  Reverse ANY of them — built-in or your own — with a sibling flag:\n");
  w('    "transition": "wipe-down", "transitionInvert": true    // sweeps up, concealing instead\n');
  w('    "transition": "custom", "transitionSource": "iris",\n');
  w('    "transitionInvert": true                               // the iris closes instead of opens\n');
  w("    Implemented in the compositor (swap the two beats, feed 1-p), so no shader knows it is\n");
  w("    being inverted and none of them can get it wrong — endpoints survive by construction.\n\n");

  w("  Carry a CAMERA through the cut with `transitionCamera` — composes with any transition,\n");
  w("  built-in or your own, and with transitionInvert. The outgoing beat keeps moving as it\n");
  w("  leaves and the incoming arrives already in motion, so the cut reads as one shot:\n");
  w(`    move    ${Object.keys(CAMERA_MOVES).join(" | ")}\n`);
  w("    zoom    >0 push in, <0 pull out    panX/panY  fraction of the frame\n");
  w("    amount  scales the whole move      blur       directional smear along the travel\n");
  w("    hold    0..0.95 (default .5) — fraction of each side HELD at full extent. This is what\n");
  w("            makes a push punch in and sit there rather than drift; 0 = continuous drift.\n");
  w('    e.g. "transitionCamera": { "move": "whip-left" }   or  { "zoom": 0.2, "blur": 0 }\n\n');

  const lib = listTransitionIds();
  w("  Custom library (bare transitionSource ids):\n");
  if (lib.length) for (const id of lib) w(`    · ${id}\n`);
  else w("    · (empty assets-lib/transitions/)\n");
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
  w("    In scope: kinoFrom(uv) / kinoTo(uv) — the two beats, already composited\n");
  w("              kinoUv(fragCoord)         — fragCoord → uv\n");
  w("              uP                        — 0 at the first overlapping frame, 1 at the last\n");
  w("              uRes / iResolution        — framebuffer size\n");
  w("              u_<name>                  — each NUMERIC transitionParams key (up to 8)\n\n");
  w("    CONTRACT: exactly kinoFrom at uP=0 and exactly kinoTo at uP=1. A transition that is a\n");
  w("    hair off at either endpoint pops on every beat boundary. Copy assets-lib/transitions/\n");
  w("    iris.frag — it shows how to overshoot both ends on purpose.\n\n");
  w("  Motion beats are NOT in the app auto-vary rotation: they default to dissolve, and only\n");
  w("  change when the beat says so. `kino still --at <boundary> --montage` to check a handoff.\n");
}
