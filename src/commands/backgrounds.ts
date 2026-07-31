import { PRESET_SCHEMAS } from "../render/backgroundSchema.js";
import { listBackgroundIds } from "../media/backgroundLib.js";
import { emitJson, wantsJson, type Choice } from "./emit.js";

// Discovery: print each animated background's controllable params + actions, so an agent knows what it
// can tween (spec.backgroundKeyframes) or trigger (spec.backgroundTriggers). Use `kino inspect` for word times.
//
// The choice list is data so `--as json` carries the RECOMMENDATION, not just the ids — "mesh is an
// easy AI tell" is the part worth having, and a bare list of names would drop exactly that.

export const CHOICES: Choice[] = [
  { label: "custom + backgroundComponent", ids: ["custom"], note: "authored brand stage (preferred when identity matters)" },
  { label: "solid", ids: ["solid"], note: "loop-safe flat palette-bg fill (seamlessLoop / settle)" },
  { label: "image", ids: ["image"], note: "brand.backdrop still + slow Ken Burns" },
  { label: "glow", ids: ["glow"], note: "calm CSS (cheap default)" },
  {
    label: "mesh / aurora / particles / grid",
    ids: ["mesh", "aurora", "particles", "grid"],
    note: "stock presets (fine for drafts; easy AI tell)",
  },
  { label: "motion beat .bg", ids: [], note: "own the ground inside the graphic (occludes all of the above)" },
];

const NOTES = [
  "Non-animated kinds: glow (CSS), image (static). custom uses the same params/pulse as presets.",
  "Drive over time: backgroundKeyframes [{ at, params, ease? }], backgroundTriggers [{ at, action }].",
  "Draw-fn contract: file body is draw(ctx, env) — env.frame / env.params / env.pulse only.",
  'Project-local: assets/backgrounds/my.js → "backgroundComponent": "backgrounds/my.js"',
  "shader (.frag): author mainImage(); uniforms iTime/iResolution/uColorA-C/uIntensity/uPulse",
  "Get timestamps from `kino inspect`. Docs: docs/backgrounds-and-overlays.md",
];

export async function backgrounds(opts: { as?: string } = {}): Promise<void> {
  const lib = listBackgroundIds();

  if (wantsJson(opts)) {
    emitJson({
      kind: "backgrounds",
      choices: CHOICES.map(({ ids, label, note }) => ({ ids, label, note })),
      library: lib,
      presets: Object.fromEntries(
        Object.entries(PRESET_SCHEMAS).map(([name, s]) => [
          name,
          {
            params: s.params.map((p) => ({
              name: p.name,
              type: p.type,
              ...(p.min !== undefined ? { min: p.min, max: p.max } : {}),
              default: p.default,
              doc: p.doc,
            })),
            actions: s.actions,
          },
        ]),
      ),
      drive: {
        keyframes: "backgroundKeyframes [{ at, params, ease? }]",
        triggers: "backgroundTriggers [{ at, action }]",
      },
      notes: NOTES,
    });
    return;
  }

  const w = process.stdout.write.bind(process.stdout);
  w("Faceless backgrounds — pick for the brand, don't default to mesh.\n\n");
  w("  Choose:\n");
  for (const c of CHOICES) w(`    · ${c.label.padEnd(30)} — ${c.note}\n`);
  w("\n");

  w("  Custom library (bare backgroundComponent ids):\n");
  if (lib.length) for (const id of lib) w(`    · ${id}\n`);
  else w("    · (empty assets-lib/backgrounds/)\n");
  w("\n");

  w("  Spec recipe (overrides brand.backgroundComponent):\n");
  w('    "background": "custom",\n');
  w('    "backgroundComponent": "brand-wash",\n');
  w('    "backgroundKeyframes": [ { "at": 0, "params": { "intensity": 0.4 } } ],\n');
  w('    "backgroundTriggers": [ { "at": 1.2, "action": "pulse" } ]\n');
  w("\n");

  w("Animated presets — agent-controllable params + actions:\n\n");
  for (const [name, s] of Object.entries(PRESET_SCHEMAS)) {
    w(`  ${name}\n`);
    for (const p of s.params) {
      const range = p.type === "number" && p.min !== undefined ? ` [${p.min}..${p.max}]` : "";
      w(`    · ${p.name} (${p.type}${range}) default ${p.default} — ${p.doc}\n`);
    }
    w(`    · actions: ${s.actions.join(", ")}\n`);
  }
  w("\n" + NOTES.map((n) => n + "\n").join(""));
}
