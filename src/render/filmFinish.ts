// Pure (fs-free, render-free) math for the cinematic finishing pass, so it's unit-testable and shared
// with the FilmFinish component. Intensity is a 0..1 scalar (spec `film`, default 1) that scales BOTH
// the edge vignette and the grain — 0 = clean edges (a light "paper" video that doesn't want a
// darkened border), 1 = the legacy graded look. The light/dark base still adapts to `night`.

// Relative luminance (0 dark → 1 light) of a #hex.
export function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
}

export interface FilmFinishParams {
  vignette: string; // CSS radial-gradient for the edge falloff
  grainOpacity: number; // opacity of the grain layer (0 = none)
}

// Resolve the vignette gradient + grain opacity for a base `night` colour and a 0..1 `film` intensity.
export function filmFinishParams(night: string, film = 1): FilmFinishParams {
  const k = Math.max(0, Math.min(1, film));
  const light = luminance(night) > 0.5;
  const a = (base: number) => (base * k).toFixed(3);
  const vignette = light
    ? `radial-gradient(ellipse 88% 76% at 50% 45%, rgba(0,0,0,0) 55%, rgba(28,20,12,${a(0.18)}) 100%)`
    : `radial-gradient(ellipse 92% 80% at 50% 45%, rgba(0,0,0,0) 46%, rgba(0,0,0,${a(0.46)}) 100%)`;
  return { vignette, grainOpacity: (light ? 0.05 : 0.09) * k };
}
