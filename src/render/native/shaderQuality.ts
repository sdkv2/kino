// Browser-side shader supersample. Node resolves the value via resolveShaderSS in engine.ts
// and ships it through render-config → window.__kinoShaderSS (set in kinoLoad).

declare global {
  interface Window {
    __kinoShaderSS?: number;
  }
}

/** Browser-side: SS from kinoLoad config, else 2. */
export function shaderSS(): number {
  const n = typeof window !== "undefined" ? Number(window.__kinoShaderSS) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? Math.round(n) : 2;
}
