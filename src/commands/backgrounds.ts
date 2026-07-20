import { PRESET_SCHEMAS } from "../render/backgroundSchema.js";
import { listBackgroundIds } from "../media/backgroundLib.js";

// Discovery: print each animated background's controllable params + actions, so an agent knows what it
// can tween (spec.backgroundKeyframes) or trigger (spec.backgroundTriggers). Use `kino inspect` for word times.
export async function backgrounds(): Promise<void> {
  process.stdout.write("Faceless backgrounds — pick for the brand, don't default to mesh.\n\n");
  process.stdout.write("  Choose:\n");
  process.stdout.write("    · custom + backgroundComponent  — authored brand stage (preferred when identity matters)\n");
  process.stdout.write("    · solid                         — loop-safe static wash (seamlessLoop / settle)\n");
  process.stdout.write("    · image                         — brand.facelessBackdrop still + slow Ken Burns\n");
  process.stdout.write("    · glow                          — calm CSS (cheap default)\n");
  process.stdout.write("    · mesh / aurora / particles / grid — stock presets (fine for drafts; easy AI tell)\n");
  process.stdout.write("    · motion beat .bg               — own the ground inside the graphic (occludes all of the above)\n");
  process.stdout.write("\n");

  const lib = listBackgroundIds();
  process.stdout.write("  Custom library (bare backgroundComponent ids):\n");
  if (lib.length) {
    for (const id of lib) process.stdout.write(`    · ${id}\n`);
  } else {
    process.stdout.write("    · (empty assets-lib/backgrounds/)\n");
  }
  process.stdout.write("\n");
  process.stdout.write('  Spec recipe (overrides brand.backgroundComponent):\n');
  process.stdout.write('    "background": "custom",\n');
  process.stdout.write('    "backgroundComponent": "brand-wash",\n');
  process.stdout.write('    "backgroundKeyframes": [ { "at": 0, "params": { "intensity": 0.4 } } ],\n');
  process.stdout.write('    "backgroundTriggers": [ { "at": 1.2, "action": "pulse" } ]\n');
  process.stdout.write("\n");
  process.stdout.write("  Draw-fn contract: file body is draw(ctx, env) — env.frame / env.params / env.pulse only.\n");
  process.stdout.write("  Project-local: assets/backgrounds/my.js → \"backgroundComponent\": \"backgrounds/my.js\"\n");
  process.stdout.write("\n");

  process.stdout.write("Animated presets — agent-controllable params + actions:\n\n");
  for (const [name, s] of Object.entries(PRESET_SCHEMAS)) {
    process.stdout.write(`  ${name}\n`);
    for (const p of s.params) {
      const range = p.type === "number" && p.min !== undefined ? ` [${p.min}..${p.max}]` : "";
      process.stdout.write(`    · ${p.name} (${p.type}${range}) default ${p.default} — ${p.doc}\n`);
    }
    process.stdout.write(`    · actions: ${s.actions.join(", ")}\n`);
  }
  process.stdout.write(
    "\nNon-animated kinds: glow (CSS), image (static). custom uses the same params/pulse as presets.\n" +
      "Drive over time: backgroundKeyframes [{ at, params, ease? }], backgroundTriggers [{ at, action }].\n" +
      "Get timestamps from `kino inspect`. Docs: docs/backgrounds-and-overlays.md\n",
  );
}
