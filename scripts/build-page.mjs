// Emit the prebuilt native render page (dist/render/native/page.bundle.js) so installed users
// never need esbuild at render time. Runs as part of `npm run build`, after tsc.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "dist/render/native/page.bundle.js");
mkdirSync(dirname(outFile), { recursive: true });

await build({
  entryPoints: [join(root, "src/render/native/page/index.tsx")],
  outfile: outFile,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

// Electron preload is plain CJS (not tsc-emitted) — keep it next to the worker in dist/.
const preloadSrc = join(root, "src/render/native/electron/preload.cjs");
const preloadDst = join(root, "dist/render/native/electron/preload.cjs");
mkdirSync(dirname(preloadDst), { recursive: true });
copyFileSync(preloadSrc, preloadDst);
