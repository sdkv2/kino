// Discoverable param/action schema for the animated backgrounds. Lives in compiled-land (not under
// remotion/) so the CLI (`kino backgrounds`) can import it. The presets render from these param names.
export type ParamValue = number | string;

export interface ParamDef {
  name: string;
  type: "number" | "color";
  default: ParamValue;
  min?: number;
  max?: number;
  doc: string;
}

export interface PresetSchema {
  params: ParamDef[];
  actions: string[];
}

const COMMON: ParamDef[] = [
  { name: "colorA", type: "color", default: "#80e2b4", doc: "primary brand colour" },
  { name: "colorB", type: "color", default: "#0c8d64", doc: "secondary colour" },
  { name: "colorC", type: "color", default: "#d99a20", doc: "accent colour" },
  { name: "intensity", type: "number", default: 0.5, min: 0, max: 1, doc: "motion / brightness strength" },
];

export const PRESET_SCHEMAS: Record<string, PresetSchema> = {
  mesh: { params: COMMON, actions: ["pulse"] },
  aurora: { params: COMMON, actions: ["pulse"] },
  particles: { params: COMMON, actions: ["pulse"] },
  grid: { params: COMMON, actions: ["pulse"] },
  solid: { params: COMMON, actions: ["pulse"] }, // loop-safe: static night base + glow, ignores frame/pulse motion
};
