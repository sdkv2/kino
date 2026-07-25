// M6: does GL compositing in sRGB reproduce what CSS compositing does? Two cases:
// a 50% white plate over a gradient (straight alpha blend), and antialiased text
// over the same gradient (per-pixel coverage alpha).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer";

const W = 1080, H = 1920, OUT = "/tmp/kino-m6";
mkdirSync(OUT, { recursive: true });

const GRADIENT = "linear-gradient(160deg,#0b1020 0%,#0c8d64 55%,#d99a20 100%)";

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });

// A: CSS composites the plate over the gradient.
await page.setContent(
  `<!doctype html><body style="margin:0">
   <div style="position:absolute;inset:0;background:${GRADIENT}"></div>
   <div style="position:absolute;left:12%;right:12%;top:40%;bottom:40%;
        background:rgba(255,255,255,0.5)"></div>
   <div style="position:absolute;inset:0;display:grid;place-items:center;
        font:800 96px Arial;color:#fff">parity</div></body>`,
);
await page.screenshot({ path: `${OUT}/dom.png` });

// B: the same three layers as textures, blended by GL in sRGB with premultiplied alpha.
await page.setContent(`<!doctype html><body style="margin:0"><canvas id="c" width="${W}" height="${H}"
  style="width:100%;height:100%"></canvas></body>`);
await page.evaluate(async (w, h, gradient) => {
  // Each layer is rasterized to its own canvas exactly as a provider would produce it.
  const layer = (paint) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    paint(c.getContext("2d"));
    return c;
  };
  const bg = layer((ctx) => {
    const g = ctx.createLinearGradient(0, 0, w * 0.34, h);
    g.addColorStop(0, "#0b1020"); g.addColorStop(0.55, "#0c8d64"); g.addColorStop(1, "#d99a20");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const plate = layer((ctx) => {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(w * 0.12, h * 0.4, w * 0.76, h * 0.2);
  });
  const text = layer((ctx) => {
    ctx.font = "800 96px Arial"; ctx.fillStyle = "#fff";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("parity", w / 2, h / 2);
  });

  const gl = document.getElementById("c").getContext("webgl2", {
    preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false, alpha: false,
  });
  const vs = `#version 300 es
    void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); gl_Position=vec4(p*2.0-1.0,0,1); }`;
  const fs = `#version 300 es
    precision highp float; uniform sampler2D uTex; uniform vec2 uRes;
    out vec4 o;
    void main(){ vec2 uv=gl_FragCoord.xy/uRes; uv.y=1.0-uv.y; o=texture(uTex,uv); }`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, "uRes"), w, h);

  gl.viewport(0, 0, w, h);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied source over destination — the CSS compositing equivalent.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);

  for (const src of [bg, plate, text]) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  gl.finish();
}, W, H, GRADIENT);

const dataUrl = await page.evaluate(() => document.getElementById("c").toDataURL("image/png"));
writeFileSync(`${OUT}/gl.png`, Buffer.from(dataUrl.split(",")[1], "base64"));

const meanDiff = execFileSync("magick", [
  `${OUT}/dom.png`, `${OUT}/gl.png`, "-compose", "difference", "-composite",
  "-format", "%[fx:mean]", "info:",
]).toString().trim();
const maxDiff = execFileSync("magick", [
  `${OUT}/dom.png`, `${OUT}/gl.png`, "-compose", "difference", "-composite",
  "-format", "%[fx:maxima]", "info:",
]).toString().trim();
console.log(`composite parity: meanDiff=${meanDiff} maxDiff=${maxDiff}`);
console.log(`PNGs in ${OUT}`);
await browser.close();
