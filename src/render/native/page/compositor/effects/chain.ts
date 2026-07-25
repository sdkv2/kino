// Ping-pong an effect chain over a rendered layer.
import { TargetPool, type RenderTarget } from "../targets.js";
import { PASS_PREAMBLE, type EffectPass } from "./pass.js";

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const registry = new Map<string, EffectPass>();
export function registerPass(pass: EffectPass): void {
  registry.set(pass.name, pass);
}
export function getPass(name: string): EffectPass | undefined {
  return registry.get(name);
}

interface Compiled {
  prog: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
}
const compiled = new WeakMap<WebGL2RenderingContext, Map<string, Compiled>>();

function compileFor(gl: WebGL2RenderingContext, pass: EffectPass): Compiled {
  let byName = compiled.get(gl);
  if (!byName) {
    byName = new Map();
    compiled.set(gl, byName);
  }
  const hit = byName.get(pass.name);
  if (hit) return hit;

  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`effect "${pass.name}" failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PASS_PREAMBLE + pass.frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`effect "${pass.name}" failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["uSrc", "uRes", "uFrame", ...(pass.uniformNames ?? [])]) {
    loc[n] = gl.getUniformLocation(prog, n);
  }
  const entry = { prog, loc };
  byName.set(pass.name, entry);
  return entry;
}

/**
 * Run `passes` over `src`, returning the final target. `src` is NOT released — the caller owns
 * it. An empty chain returns `src` itself, so callers must compare identity before releasing.
 */
export function runChain(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  src: RenderTarget,
  passes: Array<{ pass: EffectPass; params: Record<string, number | string> }>,
  frame: number,
): RenderTarget {
  if (!passes.length) return src;
  let read = src;
  let owned: RenderTarget | null = null;

  for (const { pass, params } of passes) {
    const { prog, loc } = compileFor(gl, pass);
    const write = pool.acquire(gl, src.w, src.h);
    pool.clear(gl, write);
    gl.bindFramebuffer(gl.FRAMEBUFFER, write.fbo);
    gl.viewport(0, 0, write.w, write.h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, read.tex);
    gl.uniform1i(loc.uSrc, 0);
    gl.uniform2f(loc.uRes, write.w, write.h);
    gl.uniform1f(loc.uFrame, frame);
    pass.uniforms(gl, loc, params, frame);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (owned) pool.release(owned);
    owned = write;
    read = write;
  }
  return read;
}

/** Test hook: run a chain of named passes over a fully-white 1x1 source and read the red
 *  channel back. Registers a "halve" pass so the ordering property is checkable. */
export function probeChain(canvas: HTMLCanvasElement, names: string[]): number {
  registerPass({
    name: "halve",
    frag: `void main(){ kino_frag = texture(uSrc, gl_FragCoord.xy / uRes) * 0.5; }`,
    uniforms: () => {},
  });
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const src = pool.acquire(gl, canvas.width, canvas.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, src.fbo);
  gl.viewport(0, 0, src.w, src.h);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const passes = names.map((n) => ({ pass: getPass(n)!, params: {} }));
  const out = runChain(gl, pool, src, passes, 0);
  const px = new Uint8Array(4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px[0];
}
