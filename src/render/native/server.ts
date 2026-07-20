// Static server for the render page: publicDir assets under /public/, pre-extracted video frames
// under /vframes/, plus the in-memory page bundle, render config and index shell. One server per
// process, with per-render swappable state — pages stay loaded on the same origin across render
// calls and re-init via window.kinoLoad() instead of a full navigation. Handles are unref'd so the
// server never pins the CLI process open. (http origin keeps canvas untainted and font/fetch
// semantics normal, which file:// would not.)
import { createServer, type Server } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
};

// border-box globally: a padded AbsoluteFill (width:100% + padding) must not overflow its frame —
// the composition environment sizes this way, and caption wrapping depends on it.
const INDEX_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>kino</title><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body><div id="root"></div><script src="/page.js"></script></body></html>`;

export interface ServerState {
  publicDir: string;
  framesDir: string;
  pageJs: string;
  renderConfigJson: string;
}

let running: { server: Server; url: string; state: ServerState } | null = null;

/** Start the process-wide render server (idempotent) and point it at this render's state. */
export async function ensureRenderServer(state: ServerState): Promise<{ url: string }> {
  if (running) {
    running.state = state;
    return { url: running.url };
  }
  const server = createServer((req, res) => {
    const s = running!.state;
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(INDEX_HTML);
      return;
    }
    if (url === "/page.js") {
      res.writeHead(200, { "content-type": MIME[".js"] });
      res.end(s.pageJs);
      return;
    }
    if (url === "/render-config.json") {
      res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-store" });
      res.end(s.renderConfigJson);
      return;
    }
    const roots: Array<[string, string]> = [
      ["/public/", s.publicDir],
      ["/vframes/", s.framesDir],
    ];
    for (const [prefix, root] of roots) {
      if (!url.startsWith(prefix)) continue;
      const rel = normalize(url.slice(prefix.length));
      if (rel.startsWith("..")) break;
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) break;
      res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store" });
      createReadStream(abs).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  // Neither the listener nor accepted sockets may hold the process open — browser teardown
  // (idle-close) is what ends the connections.
  server.on("connection", (socket) => socket.unref());
  server.unref();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  running = { server, url: `http://127.0.0.1:${port}`, state };
  return { url: running.url };
}
