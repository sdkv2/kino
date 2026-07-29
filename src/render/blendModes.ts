// Blend-mode vocabulary shared by segment `blend` (maskSpec.ts validateSegmentFx) and
// declared-layer `blend` (layerSpec.ts validateLayers) — one list, one place to add a mode.
//
// Lives here rather than in either validator because layerSpec.ts already value-imports
// validateMask/EFFECT_KINDS from maskSpec.ts; maskSpec.ts importing BLEND_MODES back from
// layerSpec.ts would close that into a cycle. This module imports nothing from maskSpec.ts,
// layerSpec.ts or layers.ts, so both can sit above it without one.
export const BLEND_MODES = ["normal", "screen", "multiply", "add"] as const;
