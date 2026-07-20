// Minimal static server for the render page: publicDir assets under /public/, pre-extracted video
// frames under /vframes/, plus the in-memory page bundle, render config and index shell. Local +
// ephemeral — exists only for the lifetime of one render (http origin keeps canvas untainted and
// font/fetch semantics normal, which file:// would not).
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
// the legacy composition environment sizes this way, and caption wrapping depends on it.
const INDEX_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>kino</title><style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0}</style></head><body><div id="root"></div><script src="/page.js"></script></body></html>`;

export interface RenderServer {
  url: string;
  close: () => Promise<void>;
}

export async function startRenderServer(opts: {
  publicDir: string;
  framesDir: string;
  pageJs: string;
  renderConfigJson: string;
}): Promise<RenderServer> {
  const roots: Array<[string, string]> = [
    ["/public/", opts.publicDir],
    ["/vframes/", opts.framesDir],
  ];
  const server: Server = createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "content-type": MIME[".html"] });
      res.end(INDEX_HTML);
      return;
    }
    if (url === "/page.js") {
      res.writeHead(200, { "content-type": MIME[".js"] });
      res.end(opts.pageJs);
      return;
    }
    if (url === "/render-config.json") {
      res.writeHead(200, { "content-type": MIME[".json"] });
      res.end(opts.renderConfigJson);
      return;
    }
    for (const [prefix, root] of roots) {
      if (!url.startsWith(prefix)) continue;
      const rel = normalize(url.slice(prefix.length));
      if (rel.startsWith("..")) break;
      const abs = join(root, rel);
      if (!existsSync(abs) || !statSync(abs).isFile()) break;
      res.writeHead(200, { "content-type": MIME[extname(abs).toLowerCase()] ?? "application/octet-stream" });
      createReadStream(abs).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
