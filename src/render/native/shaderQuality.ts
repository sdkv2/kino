// Browser-side shader supersample. Node resolves the value via resolveShaderSS in engine.ts
// and ships it through render-config → window.__kinoShaderSS (set in kinoLoad).

declare global {
  interface Window {
    __kinoShaderSS?: number;
    __kinoShaderFXAA?: boolean;
  }
}

/** Browser-side: SS from kinoLoad config, else 2. */
export function shaderSS(): number {
  const n = typeof window !== "undefined" ? Number(window.__kinoShaderSS) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 4 ? Math.round(n) : 2;
}

/** Browser-side: FXAA edge post-pass on shader backgrounds. On unless kinoLoad set it false. */
export function shaderFXAA(): boolean {
  return typeof window === "undefined" ? true : window.__kinoShaderFXAA !== false;
}
