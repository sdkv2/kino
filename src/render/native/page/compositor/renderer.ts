// The stage renderer: an ordered list of textured quads drawn into one WebGL2 surface.
// Blending is sRGB with premultiplied alpha, matching CSS compositing semantics — linear
// blending would shift every existing spec.
//
// Everything here runs in the SYNCHRONOUS draw phase. No awaits, no decodes, no layout:
// sources have already been prepared by the time draw() is called.
import { IDENTITY_TRANSFORM, type BlendMode, type LayerDraw, type TextureSource } from "./graph.js";
import { BASE_GROUP, groupRuns } from "./groups.js";
import { TargetPool, type RenderTarget } from "./targets.js";
import { applyMask, type MaskBinding } from "./masks.js";
import { resolveMaskDefaults, type LayerMask } from "../../../maskSpec.js";
import { getPass, runChain, type EffectPass } from "./effects/index.js";
import { registerBackdropTexture, clearBackdropTexture } from "../liquidGlass.js";

const VERT = `#version 300 es
// Unit quad from gl_VertexID, positioned by a 3x3 model matrix in pixel space.
uniform mat3 uModel;
uniform vec2 uRes;
uniform float uFlipY;
out vec2 vUv;
void main() {
  vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 0.5;  // 0,0 / 1,0 / 0,1
  vec2 quad = vec2(corner.x > 0.5 ? 1.0 : 0.0, corner.y > 0.5 ? 1.0 : 0.0);
  vUv = vec2(quad.x, uFlipY > 0.5 ? 1.0 - quad.y : quad.y);
  vec3 p = uModel * vec3(quad, 1.0);
  vec2 clip = (p.xy / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);  // y-down pixel space → clip space
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform float uOpacity;
in vec2 vUv;
out vec4 kino_frag;
void main() {
  vec4 c = texture(uTex, vUv);
  kino_frag = c * uOpacity;   // premultiplied — scaling the whole texel is correct
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`compositor shader failed to compile: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

/** Blend equations per mode. Sources are premultiplied, so "normal" is ONE / 1-SRC_ALPHA. */
function applyBlend(gl: WebGL2RenderingContext, mode: BlendMode): void {
  gl.enable(gl.BLEND);
  switch (mode) {
    case "add":
      gl.blendFunc(gl.ONE, gl.ONE);
      break;
    case "screen":
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    case "multiply":
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      break;
    default:
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}

/** Column-major 3x3: translate ∘ rotate ∘ scale about the rect center, in pixel space. */
function modelMatrix(layer: LayerDraw): Float32Array {
  const { x, y, w, h } = layer.rect;
  const { scale, rotate, translate } = layer.transform;
  const rad = (rotate * Math.PI) / 180;
  const cos = Math.cos(rad) * scale;
  const sin = Math.sin(rad) * scale;
  const cx = x + w / 2 + translate[0];
  const cy = y + h / 2 + translate[1];
  // unit quad → centered → scaled/rotated → placed
  const a = cos * w, b = sin * w;
  const c = -sin * h, d = cos * h;
  const tx = cx - (a + c) / 2;
  const ty = cy - (b + d) / 2;
  return new Float32Array([a, b, 0, c, d, 0, tx, ty, 1]);
}

export class StageRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uModel: WebGLUniformLocation;
  private uRes: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private uTex: WebGLUniformLocation;
  private uFlipY: WebGLUniformLocation;
  readonly width: number;
  readonly height: number;

  constructor(canvas: HTMLCanvasElement, opts: { width: number; height: number; ss: number }) {
    this.width = opts.width;
    this.height = opts.height;
    canvas.width = opts.width;
    canvas.height = opts.height;
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: true,
      antialias: false,
      alpha: false,
    });
    if (!gl) throw new Error("compositor: WebGL2 unavailable");
    this.gl = gl;

    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`compositor program failed to link: ${gl.getProgramInfoLog(prog)}`);
    }
    this.prog = prog;
    this.uModel = gl.getUniformLocation(prog, "uModel")!;
    this.uRes = gl.getUniformLocation(prog, "uRes")!;
    this.uOpacity = gl.getUniformLocation(prog, "uOpacity")!;
    this.uTex = gl.getUniformLocation(prog, "uTex")!;
    this.uFlipY = gl.getUniformLocation(prog, "uFlipY")!;
  }

  draw(layers: LayerDraw[], sources: Map<string, TextureSource>, frame: number): void {
    const gl = this.gl;
    // Full state reset every frame — a leaked flag from a provider's own program would make
    // output depend on draw history, which breaks determinism.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);

    // Layers referenced as masks are rendered first, into their own targets.
    const maskTargets = new Map<string, RenderTarget>();
    for (const layer of layers) {
      const ref = (layer.mask as any)?.source;
      if (ref?.kind !== "layer" || maskTargets.has(ref.layerId)) continue;
      const maskLayer = layers.find((l) => l.id === ref.layerId);
      const maskSource = maskLayer && sources.get(maskLayer.source.providerId);
      if (!maskLayer || !maskSource) continue;
      const t = this.drawToTarget(maskLayer, maskSource, frame);
      if (t) maskTargets.set(ref.layerId, t);
    }

    const accum = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, accum);

    for (const run of groupRuns(layers)) {
      this.compositeRun(accum, run, sources, frame, maskTargets);
    }
    for (const t of maskTargets.values()) this.pool.release(t);

    // Blit accumulated composite to default screen framebuffer (FBO texture memory has t=1 at top, t=0 at bottom)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, 1.0);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accum.tex);
    gl.uniformMatrix3fv(
      this.uModel,
      false,
      modelMatrix({ id: "_accum", rect: { x: 0, y: 0, w: this.width, h: this.height }, transform: IDENTITY_TRANSFORM, source: null as any, opacity: 1, blend: "normal", effects: [] }),
    );
    gl.uniform1f(this.uOpacity, 1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.pool.release(accum);
    clearBackdropTexture();
    gl.finish();
  }

  private pool = new TargetPool();

  /** Walk a consecutive same-group run. Beat groups with multiple layers render to a temp target first. */
  private compositeRun(
    accum: RenderTarget,
    run: LayerDraw[],
    sources: Map<string, TextureSource>,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): void {
    const isBeatGroup = (run[0].group ?? BASE_GROUP) !== BASE_GROUP;
    const needsGroupTarget = isBeatGroup && run.length > 1;
    if (!needsGroupTarget) {
      for (const layer of run) this.compositeLayer(accum, layer, sources, frame, maskTargets);
      return;
    }
    const gl = this.gl;
    const group = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, group);
    for (const layer of run) this.compositeLayer(group, layer, sources, frame, maskTargets);
    this.blitTarget(accum, group, 1, "normal");
    this.pool.release(group);
  }

  private blitTarget(dest: RenderTarget, src: RenderTarget, opacity: number, blend: BlendMode): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, 0);
    applyBlend(gl, blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniformMatrix3fv(
      this.uModel,
      false,
      modelMatrix({
        id: "_blit",
        rect: { x: 0, y: 0, w: this.width, h: this.height },
        transform: IDENTITY_TRANSFORM,
        source: { providerId: "" },
        opacity: 1,
        blend: "normal",
        effects: [],
      }),
    );
    gl.uniform1f(this.uOpacity, opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private compositeLayer(
    dest: RenderTarget,
    layer: LayerDraw,
    sources: Map<string, TextureSource>,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): void {
    const gl = this.gl;
    const source = sources.get(layer.source.providerId);
    if (!source) return;

    registerBackdropTexture(dest.tex, this.width, this.height);

    const chain = layer.effects
      .map((e) => ({ pass: getPass(e.kind), params: e.params }))
      .filter((e): e is { pass: EffectPass; params: Record<string, number | string> } => Boolean(e.pass));

    if (layer.mask || chain.length) {
      const rendered = this.drawToTarget(layer, source, frame);
      if (!rendered) return;

      let current = rendered;
      if (layer.mask) {
        const maskObj: LayerMask = "source" in layer.mask
          ? (layer.mask as unknown as LayerMask)
          : {
              source: { kind: "file", src: (layer.mask as any).providerId, channel: (layer.mask as any).channel ?? "a" },
              feather: (layer.mask as any).feather,
              invert: (layer.mask as any).invert,
            };
        const resolved = resolveMaskDefaults(maskObj);
        let binding: MaskBinding = { mask: null, sdf: null, sdfMax: 0 };
        if (resolved.source.kind === "layer") {
          const mt = maskTargets.get(resolved.source.layerId);
          binding = { mask: mt ? mt.tex : null, sdf: null, sdfMax: 0 };
        }
        const masked = applyMask(gl, this.pool, rendered, resolved, binding);
        this.pool.release(rendered);
        current = masked;
      }

      const finalTarget = chain.length ? runChain(gl, this.pool, current, chain, frame) : current;

      gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.prog);
      gl.uniform1f(this.uFlipY, 0);
      applyBlend(gl, layer.blend);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, finalTarget.tex);
      gl.uniformMatrix3fv(
        this.uModel,
        false,
        modelMatrix({ ...layer, rect: { x: 0, y: 0, w: this.width, h: this.height }, transform: IDENTITY_TRANSFORM }),
      );
      gl.uniform1f(this.uOpacity, layer.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      if (finalTarget !== current) this.pool.release(finalTarget);
      this.pool.release(current);
      return;
    }

    const tex = source.texture(gl, frame, layer.source.key);
    if (!tex) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, 0);
    applyBlend(gl, layer.blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(layer));
    gl.uniform1f(this.uOpacity, layer.opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Draw a single layer into an offscreen target, unblended, at frame scale. The caller
   *  owns the target and must release it. */
  drawToTarget(layer: LayerDraw, source: TextureSource, frame: number): RenderTarget | null {
    const gl = this.gl;
    const tex = source.texture(gl, frame, layer.source.key);
    if (!tex) return null;
    const target = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, target);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, 0);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(layer));
    gl.uniform1f(this.uOpacity, 1); // opacity applies at composite time, not here
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
  }

  releaseTarget(target: RenderTarget): void {
    this.pool.release(target);
  }

  dispose(): void {
    this.pool.dispose(this.gl);
    this.gl.deleteProgram(this.prog);
  }
}
