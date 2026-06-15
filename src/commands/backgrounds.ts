import { PRESET_SCHEMAS } from "../render/backgroundSchema.js";

// Discovery: print each animated background's controllable params + actions, so an agent knows what it
// can tween (spec.backgroundKeyframes) or trigger (spec.backgroundTriggers). Use `kino inspect` for word times.
export async function backgrounds(): Promise<void> {
  process.stdout.write("Animated backgrounds — agent-controllable params + actions:\n\n");
  for (const [name, s] of Object.entries(PRESET_SCHEMAS)) {
    process.stdout.write(`  ${name}\n`);
    for (const p of s.params) {
      const range = p.type === "number" && p.min !== undefined ? ` [${p.min}..${p.max}]` : "";
      process.stdout.write(`    · ${p.name} (${p.type}${range}) default ${p.default} — ${p.doc}\n`);
    }
    process.stdout.write(`    · actions: ${s.actions.join(", ")}\n`);
  }
  process.stdout.write(
    "\nNon-animated kinds: glow (CSS), image (static), custom (your own draw fn — gets env.params + env.pulse).\n" +
      'Drive over time in the spec: backgroundKeyframes [{ at, params: { intensity, colorA, … }, ease? }],\n' +
      "backgroundTriggers [{ at, action }]. Get timestamps from `kino inspect` (per-word start/end).\n",
  );
}
