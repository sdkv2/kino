/** puppeteer (default) or electron offscreen paint capture. */
export type NativeRenderer = "puppeteer" | "electron";

export function resolveRenderer(env: NodeJS.ProcessEnv = process.env): NativeRenderer {
  return env.KINO_RENDERER === "electron" ? "electron" : "puppeteer";
}

export function isElectronProcess(): boolean {
  return Boolean(process.versions.electron);
}
