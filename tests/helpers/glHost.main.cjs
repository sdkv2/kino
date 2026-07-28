// Electron main process for the compositor GL test harness.
//
// Replaces the per-test `puppeteer.launch()` the compositor tests used to do. One hidden
// BrowserWindow serves every probe in a test file: each request loads a fresh HTML file (so GL
// state never leaks between probes), injects an esbuild bundle, and evaluates one function.
//
// Protocol is newline-delimited JSON, every line tagged so Chromium's own stdout chatter can be
// ignored by the parent:
//   → {"id":1,"htmlPath":"…","script":"…","fn":"(a)=>…","args":[…]}\n   (stdin, or TCP on win32)
//   ← @KINOGL {"id":1,"ok":true,"value":…}\n                            (stdout)
//
// Plain CJS on purpose: Electron needs a real .js/.cjs entry, and keeping this out of tsc means the
// harness works from a bare checkout with no build step.
const { app, BrowserWindow } = require("electron");
const { createInterface } = require("node:readline");
const { connect } = require("node:net");

const TAG = "@KINOGL ";

let win = null;

function reply(obj) {
  process.stdout.write(TAG + JSON.stringify(obj) + "\n");
}

async function ensureWindow() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: {
      // No node in the page: the bundles under test are browser code and must not accidentally
      // resolve a node builtin that would not exist in the real render page.
      nodeIntegration: false,
      contextIsolation: false,
      offscreen: false,
      // Chromium throttles/parks background renderers; a hidden window is always backgrounded, and
      // a parked renderer turns a probe into a timeout rather than a failure.
      backgroundThrottling: false,
    },
  });
  return win;
}

/**
 * One probe. `htmlPath` is a real file rather than a data: URL — file: keeps the page a normal
 * same-origin document, which matters because several probes read back canvas pixels and a
 * data:-origin canvas is treated as opaque by some paths.
 */
async function runProbe({ htmlPath, script, fn, args }) {
  const w = await ensureWindow();
  await w.loadFile(htmlPath);
  if (script) await w.webContents.executeJavaScript(script);
  // Wrapped in Promise.resolve so a probe may be async; JSON.stringify normalises the result to
  // exactly what the parent's JSON.parse will see, so a value that cannot survive the wire fails
  // here (loudly, with the probe's own id) instead of arriving silently mangled.
  const call = `(async () => {
    const __fn = ${fn};
    const __v = await Promise.resolve(__fn(...${JSON.stringify(args ?? [])}));
    return JSON.stringify(__v === undefined ? null : __v);
  })()`;
  const raw = await w.webContents.executeJavaScript(call);
  return JSON.parse(raw);
}

function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    reply({ id: -1, ok: false, error: `unparseable request: ${String(e)}` });
    return;
  }
  if (req.cmd === "quit") {
    app.quit();
    return;
  }
  runProbe(req).then(
    (value) => reply({ id: req.id, ok: true, value }),
    (e) => reply({ id: req.id, ok: false, error: e && e.message ? e.message : String(e) }),
  );
}

function listen(stream) {
  createInterface({ input: stream }).on("line", handleLine);
}

app.whenReady().then(() => {
  // Windows: Electron closes piped stdin immediately, so commands arrive over a TCP socket the
  // parent bound before spawning. Same split as src/render/native/electron/slots.ts.
  const port = Number(process.env.KINO_GLHOST_CMD_PORT);
  if (Number.isFinite(port) && port > 0) {
    const sock = connect(port, "127.0.0.1", () => listen(sock));
    sock.on("error", (e) => {
      process.stderr.write(`[glhost] cmd socket error: ${String(e)}\n`);
      process.exit(1);
    });
  } else {
    listen(process.stdin);
  }
  reply({ id: 0, ok: true, value: "ready" });
});

// A hidden window that finishes a probe must not end the process — the parent decides when to quit.
app.on("window-all-closed", () => {});
