// The stage renderer: an ordered list of textured quads drawn into one WebGL2 surface.
// Blending is LINEAR LIGHT with premultiplied alpha. The mechanism is the target format, not any
// blendFunc: TargetPool hands out SRGB8_ALPHA8, which WebGL2 decodes on sample and encodes on
// write.
//
// Everything here runs in the SYNCHRONOUS draw phase. No awaits, no decodes, no layout:
// sources have already been prepared by the time draw() is called.
import { IDENTITY_TRANSFORM, type BlendMode, type LayerDraw, type TextureSource } from "./graph.js";
import { BASE_GROUP, groupRuns, groupsOf } from "./groups.js";
import { TargetPool, type RenderTarget } from "./targets.js";
import { applyMask, type MaskBinding } from "./masks.js";
import { resolveMaskDefaults, type LayerMask } from "../../../maskSpec.js";
import { getPass, runChain, type EffectPass } from "./effects/index.js";
import { resolveFilmPass, resolveTailPostChain, runPost } from "./post.js";
import type { PostFx } from "../../../postSpec.js";
import type { Theme } from "../../../props.js";
import { clearBackdrop, registerBackdropTexture } from "../backdrop.js";
import { mixGroups } from "./transitions/index.js";
import {
  groupSpans,
  transitionKindForWindow,
  transitionProgress,
} from "../../../transitionSpec.js";
import type { KinoProps } from "../../../props.js";
import { CompositeResolve } from "./resolve.js";
import { shaderFXAA } from "../../shaderQuality.js";
import * as prof from "./profile.js";

// Two texture origins meet in this file, and mixing them up mirrors the frame.
//
//   UPLOADED   (uploadCanvasOrImage: canvas/img/video, UNPACK_FLIP_Y_WEBGL=false)
//              row 0 of the source image is v=0, so the visual TOP is v=0.
//   RENDERED   (a RenderTarget an FBO pass wrote into)
//              the quad program maps y-down pixel space to clip via `-clip.y`, so the visual
//              TOP lands at the highest GL row — v=1.
//
// The quad program samples with v ascending downwards, which is the UPLOADED convention. So every
// draw whose bound texture is a RENDERED target must set uFlipY=1; every draw of an UPLOADED
// texture must set uFlipY=0. Use SAMPLE_RENDERED / SAMPLE_UPLOADED rather than bare literals.
const SAMPLE_UPLOADED = 0;
const SAMPLE_RENDERED = 1;

// What a bound texture needs on the way into the linear-light blend. Which one applies depends
// on who produced the texture, not on what it depicts:
//
//   DECODE_NONE        a compositor TargetPool target — SRGB8_ALPHA8, so GL already decoded it,
//                      and its contents are premultiplied linear. Nothing to do.
//   DECODE_PREMUL      an uploadCanvasOrImage texture — SRGB8_ALPHA8 with STRAIGHT alpha, so GL
//                      decoded the colour and the shader still owes the premultiply.
//   DECODE_SRGB_PREMUL a provider-rendered RGBA8 texture (motion.ts on its gpuRendered path),
//                      holding sRGB values already premultiplied in sRGB. The premultiply has to
//                      be undone before the decode, because decode(c*a) != decode(c)*a.
const DECODE_NONE = 0;
const DECODE_PREMUL = 1;
const DECODE_SRGB_PREMUL = 2;

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
uniform int uDecode;
uniform float uEncode;
uniform float uTextGamma;
in vec2 vUv;
out vec4 kino_frag;

vec3 kinoToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 kinoToSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec4 c = texture(uTex, vUv);
  if (uDecode == 1) {
    // Coverage gamma first: glyph rasters are hinted for sRGB compositing and read thin when
    // their coverage is blended in linear light. 1.0 is the no-op path for everything else.
    float a = uTextGamma == 1.0 ? c.a : pow(c.a, 1.0 / uTextGamma);
    c = vec4(c.rgb * a, a);                      // GL decoded; premultiply in linear
  } else if (uDecode == 2) {
    vec3 straight = c.a > 0.0 ? c.rgb / c.a : c.rgb;
    c = vec4(kinoToLinear(straight) * c.a, c.a); // undo sRGB premultiply, decode, redo in linear
  }
  c *= uOpacity;                                 // premultiplied — scaling the whole texel is correct
  // Present only. The composite is opaque there (the frame clears to opaque black and the context
  // is alpha:false), so encoding the premultiplied rgb needs no unpremultiply.
  if (uEncode > 0.5) c = vec4(kinoToSRGB(c.rgb), c.a);
  kino_frag = c;
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

/** Motion, overlays, type, and logo sit above the cinematic finish — same stack as KinoVideo. */
function isAboveFilmLayer(layer: LayerDraw): boolean {
  if (layer.aboveFilm) return true;
  const id = layer.id;
  return (
    id.startsWith("motion") ||
    id.startsWith("overlay") ||
    id.startsWith("text") ||
    id.startsWith("caption") ||
    id === "disclosure" ||
    id === "logo"
  );
}

export class StageRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private uModel: WebGLUniformLocation;
  private uRes: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private uTex: WebGLUniformLocation;
  private uFlipY: WebGLUniformLocation;
  private uDecode: WebGLUniformLocation;
  private uEncode: WebGLUniformLocation;
  private uTextGamma: WebGLUniformLocation;
  readonly width: number;
  readonly height: number;
  readonly outW: number;
  readonly outH: number;
  readonly ss: number;
  private resolve: CompositeResolve;

  constructor(canvas: HTMLCanvasElement, opts: { width: number; height: number; ss: number }) {
    this.ss = Math.max(1, opts.ss);
    this.outW = opts.width;
    this.outH = opts.height;
    this.width = this.outW * this.ss;
    this.height = this.outH * this.ss;
    canvas.width = this.outW;
    canvas.height = this.outH;
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
    this.uDecode = gl.getUniformLocation(prog, "uDecode")!;
    this.uEncode = gl.getUniformLocation(prog, "uEncode")!;
    this.uTextGamma = gl.getUniformLocation(prog, "uTextGamma")!;
    this.resolve = new CompositeResolve(gl);
  }

  /**
   * Time one GL phase. GL commands are queued, not executed, so a bare timer would credit every
   * phase's real cost to the trailing gl.finish(). When profiling is on this flushes after each
   * phase to attribute it correctly — which serializes the pipeline, so profiled runs are SLOWER
   * than real ones. Use the shares, not the absolute totals.
   */
  private glPhase<T>(key: string, fn: () => T): T {
    if (!prof.profileOn()) return fn();
    return prof.sync(key, () => {
      const r = fn();
      this.gl.finish();
      return r;
    });
  }

  private scaled(layer: LayerDraw): LayerDraw {
    if (this.ss === 1) return layer;
    const s = this.ss;
    const { x, y, w, h } = layer.rect;
    const { translate, scale, rotate } = layer.transform;
    return {
      ...layer,
      rect: { x: x * s, y: y * s, w: w * s, h: h * s },
      transform: { scale, rotate, translate: [translate[0] * s, translate[1] * s] },
    };
  }

  draw(
    layers: LayerDraw[],
    sources: Map<string, TextureSource>,
    frame: number,
    opts: { theme: Theme; postFx?: PostFx; props: KinoProps },
  ): void {
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

    const maskTargets = new Map<string, RenderTarget>();
    let accum = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, accum);

    const transition = transitionProgress({ groups: groupSpans(opts.props), frame });
    const skipGroups = transition ? new Set([transition.from, transition.to]) : null;

    // Layer masks are built just before the layers that consume them — after photographic
    // compositing, so pool reuse cannot scribble over a held mask source (SS=2 pressure).
    const ensureLayerMaskTarget = (layerId: string): void => {
      if (maskTargets.has(layerId)) return;
      const maskLayer = layers.find((l) => l.id === layerId || l.source.providerId === layerId);
      const providerId = maskLayer ? maskLayer.source.providerId : layerId;
      const maskSource = sources.get(providerId);
      if (!maskSource) return;
      const targetLayer: LayerDraw = maskLayer ?? {
        id: layerId,
        source: { providerId },
        rect: { x: 0, y: 0, w: this.outW, h: this.outH },
        transform: IDENTITY_TRANSFORM,
        opacity: 1,
        blend: "normal",
        textGamma: 1,
        effects: [],
      };
      const t = this.drawMaskSource(targetLayer, maskSource, frame);
      if (t) {
        maskTargets.set(layerId, t);
        this.pool.hold(t);
      }
    };

    const belowFilm = layers.filter((l) => !isAboveFilmLayer(l));
    const aboveFilm = layers.filter((l) => isAboveFilmLayer(l));

    for (const layer of belowFilm) {
      const ref = (layer.mask as { source?: { kind?: string; layerId?: string } })?.source;
      if (ref?.kind === "layer" && ref.layerId) ensureLayerMaskTarget(ref.layerId);
    }

    this.glPhase("draw:composite-below", () => {
      for (const run of groupRuns(belowFilm)) {
        const gid = run[0].group ?? BASE_GROUP;
        if (skipGroups?.has(gid)) continue;
        this.compositeRun(accum, run, sources, frame, maskTargets);
      }
    });

    const filmChain = resolveFilmPass(opts.postFx, opts.theme, this.ss);
    if (filmChain.length) {
      const filmed = this.glPhase("draw:film", () => runPost(gl, this.pool, accum, filmChain, frame));
      if (filmed !== accum) {
        this.pool.release(accum);
        accum = filmed;
      }
    }

    for (const layer of aboveFilm) {
      const ref = (layer.mask as { source?: { kind?: string; layerId?: string } })?.source;
      if (ref?.kind === "layer" && ref.layerId) ensureLayerMaskTarget(ref.layerId);
    }

    this.glPhase("draw:composite-above", () => {
      for (const run of groupRuns(aboveFilm)) {
        const gid = run[0].group ?? BASE_GROUP;
        if (skipGroups?.has(gid)) continue;
        this.compositeRun(accum, run, sources, frame, maskTargets);
      }
    });

    if (transition) {
      const byGroup = groupsOf(layers);
      const fromLayers = (byGroup.get(transition.from) ?? []).map((l) => ({ ...l, opacity: 1 }));
      const toLayers = (byGroup.get(transition.to) ?? []).map((l) => ({ ...l, opacity: 1 }));
      const fromTarget = this.compositeLayersToTarget(fromLayers, sources, frame, maskTargets);
      const toTarget = this.compositeLayersToTarget(toLayers, sources, frame, maskTargets);
      if (fromTarget && toTarget) {
        const kind = transitionKindForWindow(opts.props, transition);
        const mixed = mixGroups(gl, this.pool, fromTarget, toTarget, kind, transition.p);
        this.blitTarget(accum, mixed, 1, "normal");
        this.pool.release(fromTarget);
        this.pool.release(toTarget);
        this.pool.release(mixed);
      }
    }
    for (const t of maskTargets.values()) this.pool.unhold(t);

    // Resolve to OUTPUT resolution BEFORE the tail post chain. grade/bloom/lens are full-frame
    // passes, so at SS=2 they each burn 4× the fill for no anti-aliasing benefit — the AA comes
    // from compositing the layers at SS, which is finished by here. Bloom's pixel radius is
    // compensated in resolveTailPostChain so the visible result is unchanged.
    if (this.ss > 1) {
      const resolved = this.pool.acquire(gl, this.outW, this.outH);
      // No FXAA here, ever. It is a luma-gradient blur with no subpixel data, so applied to the
      // whole composite it smears glyph edges — measured at 0.0148 deviation on menubar text
      // versus 0.0073 with it off, and obvious at 5x. The one layer class that wants FXAA (shader
      // backgrounds) already runs its own, layer-local, in shaderHost. This pass only downsamples.
      this.glPhase("draw:resolve", () =>
        this.resolve.resolveTo(resolved.fbo, accum.tex, this.outW, this.outH, false),
      );
      this.pool.release(accum);
      accum = resolved;
    }

    let composite = accum;
    const posted = this.glPhase("draw:post-tail", () =>
      runPost(gl, this.pool, accum, resolveTailPostChain(opts.postFx, opts.theme, this.ss), frame),
    );
    if (posted !== accum) {
      this.pool.release(accum);
      composite = posted;
    }

    // Composite is at output resolution either way now — straight 1:1 blit to the canvas.
    this.glPhase("draw:present", () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.outW, this.outH);
      gl.useProgram(this.prog);
      gl.uniform1f(this.uFlipY, SAMPLE_RENDERED);
      gl.uniform1i(this.uDecode, DECODE_NONE);
      // The only encode in the pipeline: the default drawing buffer is plain RGBA8, so unlike a
      // pool target it will not encode on write. Everything else stays linear.
      gl.uniform1f(this.uEncode, 1);
      gl.uniform1f(this.uTextGamma, 1); // already applied when the layer was drawn into this target
      gl.uniform2f(this.uRes, this.outW, this.outH);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, composite.tex);
      gl.uniformMatrix3fv(
        this.uModel,
        false,
        modelMatrix({ id: "_accum", rect: { x: 0, y: 0, w: this.outW, h: this.outH }, transform: IDENTITY_TRANSFORM, source: null as any, opacity: 1, blend: "normal", textGamma: 1, effects: [] }),
      );
      gl.uniform1f(this.uOpacity, 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    });
    this.pool.release(composite);
    clearBackdrop();
    prof.sync("draw:finish", () => gl.finish());
  }

  private pool = new TargetPool();

  // The backdrop published to lens/glass consumers is RGBA8 holding sRGB BYTES, not a pool target.
  // Those consumers are user-authored shaders that expect the sRGB values the compositor used to
  // blend in; publishing a pool target would hand them linear values.
  private snapTex: WebGLTexture | null = null;
  private snapFbo: WebGLFramebuffer | null = null;
  private snapW = 0;
  private snapH = 0;

  private compositeLayersToTarget(
    layers: LayerDraw[],
    sources: Map<string, TextureSource>,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): RenderTarget | null {
    if (!layers.length) return null;
    const gl = this.gl;
    const group = this.pool.acquire(gl, this.width, this.height);
    this.pool.clear(gl, group);
    for (const layer of layers) this.compositeLayer(group, layer, sources, frame, maskTargets);
    return group;
  }

  private compositeRun(
    accum: RenderTarget,
    run: LayerDraw[],
    sources: Map<string, TextureSource>,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): void {
    const isBeatGroup = (run[0].group ?? BASE_GROUP) !== BASE_GROUP;
    const layerMask = (l: LayerDraw) => (l.mask as { source?: { kind?: string } } | undefined)?.source?.kind === "layer";
    const needsGroupTarget = isBeatGroup && run.length > 1 && !run.some(layerMask);
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
    gl.uniform1f(this.uFlipY, SAMPLE_RENDERED);
    gl.uniform1i(this.uDecode, DECODE_NONE);
    gl.uniform1f(this.uEncode, 0);
    gl.uniform1f(this.uTextGamma, 1); // already applied when the layer was drawn into this target
    gl.uniform2f(this.uRes, this.width, this.height);
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
        textGamma: 1,
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
    if (!prof.profileOn()) {
      this.compositeLayerInner(dest, layer, sources, frame, maskTargets);
      return;
    }
    // Offscreen path (mask or effect chain) costs several FULL-FRAME passes; the direct path is
    // one quad over the layer rect. Label them apart so the profile says which is eating the frame.
    const path = layer.mask || layer.effects.length ? "target" : "direct";
    this.glPhase(`layer:${layer.id}:${path}`, () =>
      this.compositeLayerInner(dest, layer, sources, frame, maskTargets),
    );
  }

  private sampleFlip(source: TextureSource, frame: number, key?: string): number {
    return source.textureIsRendered?.(frame, key) ? SAMPLE_RENDERED : SAMPLE_UPLOADED;
  }

  /** Companion to sampleFlip: which colour-space fixup this source's texture needs. */
  private sampleDecode(source: TextureSource, frame: number, key?: string): number {
    return source.textureIsRendered?.(frame, key) ? DECODE_SRGB_PREMUL : DECODE_PREMUL;
  }

  /**
   * Snapshot `dest` for backdrop consumers, re-encoded to sRGB BYTES.
   *
   * Not a blitFramebuffer any more: the source is SRGB8_ALPHA8 and the destination must hold the
   * ENCODED values, so this goes through the quad program with uEncode set. The consumers are
   * user-authored shaders — drawLensLayerPassEntry resolves fragment source through
   * fragForId(entry.lensId, lensShaders) and binds this texture as uBg — so there is no single
   * shader to patch, and handing them linear values would silently darken every refraction.
   */
  private publishCompositorBackdrop(dest: RenderTarget): void {
    const gl = this.gl;
    if (!this.snapTex || this.snapW !== dest.w || this.snapH !== dest.h) {
      if (this.snapTex) gl.deleteTexture(this.snapTex);
      if (this.snapFbo) gl.deleteFramebuffer(this.snapFbo);
      this.snapTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.snapTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, dest.w, dest.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.snapFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.snapTex, 0);
      this.snapW = dest.w;
      this.snapH = dest.h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.snapFbo);
    gl.viewport(0, 0, dest.w, dest.h);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, SAMPLE_RENDERED);
    gl.uniform1i(this.uDecode, DECODE_NONE);
    gl.uniform1f(this.uTextGamma, 1);
    gl.uniform1f(this.uEncode, 1);
    gl.uniform2f(this.uRes, dest.w, dest.h);
    gl.disable(gl.BLEND);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dest.tex);
    gl.uniformMatrix3fv(
      this.uModel,
      false,
      modelMatrix({
        id: "_snap",
        rect: { x: 0, y: 0, w: dest.w, h: dest.h },
        transform: IDENTITY_TRANSFORM,
        source: { providerId: "" },
        opacity: 1,
        blend: "normal",
        textGamma: 1,
        effects: [],
      }),
    );
    gl.uniform1f(this.uOpacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    registerBackdropTexture(this.snapTex, dest.w, dest.h);
  }

  private compositeLayerInner(
    dest: RenderTarget,
    layer: LayerDraw,
    sources: Map<string, TextureSource>,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): void {
    const source = sources.get(layer.source.providerId);
    if (!source) return;

    // The snapshot is owned by the renderer and reused across frames, so there is nothing to
    // release here — only the registration to clear, which keeps the published backdrop scoped
    // to the layer that asked for it.
    let backdropSnap = false;
    if (source.needsCompositorBackdrop?.(frame, layer.source.key)) {
      this.publishCompositorBackdrop(dest);
      backdropSnap = true;
    }
    try {
      this.compositeLayerInnerWithBackdrop(dest, layer, source, frame, maskTargets);
    } finally {
      if (backdropSnap) clearBackdrop();
    }
  }

  private compositeLayerInnerWithBackdrop(
    dest: RenderTarget,
    layer: LayerDraw,
    source: TextureSource,
    frame: number,
    maskTargets: Map<string, RenderTarget>,
  ): void {
    const gl = this.gl;

    const chain = layer.effects
      .map((e) => ({ pass: getPass(e.kind), params: e.params }))
      .filter((e): e is { pass: EffectPass; params: Record<string, number | string> } => Boolean(e.pass));

    if (layer.mask || chain.length) {
      // drawToTarget scales to frame resolution itself — pre-scaling here would apply ss twice.
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
          if (!mt?.tex) {
            current = rendered;
          } else {
            binding = { mask: mt.tex, sdf: null, sdfMax: 0 };
            const masked = applyMask(gl, this.pool, rendered, resolved, binding, this.ss);
            this.pool.release(rendered);
            current = masked;
          }
        } else {
          const masked = applyMask(gl, this.pool, rendered, resolved, binding, this.ss);
          this.pool.release(rendered);
          current = masked;
        }
      }

      const finalTarget = chain.length ? runChain(gl, this.pool, current, chain, frame) : current;

      gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.prog);
      gl.uniform1f(this.uFlipY, SAMPLE_RENDERED);
      gl.uniform1i(this.uDecode, DECODE_NONE);
      gl.uniform1f(this.uEncode, 0);
      gl.uniform1f(this.uTextGamma, 1); // already applied when the layer was drawn into this target
      gl.uniform2f(this.uRes, this.width, this.height);
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

    const tex = this.glPhase(`texture:${layer.id}`, () => source.texture(gl, frame, layer.source.key));
    if (!tex) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dest.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, this.sampleFlip(source, frame, layer.source.key));
    gl.uniform1i(this.uDecode, this.sampleDecode(source, frame, layer.source.key));
    gl.uniform1f(this.uEncode, 0);
    gl.uniform1f(this.uTextGamma, layer.textGamma);
    gl.uniform2f(this.uRes, this.width, this.height);
    applyBlend(gl, layer.blend);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(this.scaled(layer)));
    gl.uniform1f(this.uOpacity, layer.opacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Layer-mask sources render at composition resolution (mask UV is comp-space when SS>1). */
  private drawMaskSource(layer: LayerDraw, source: TextureSource, frame: number): RenderTarget | null {
    const gl = this.gl;
    const tex = source.texture(gl, frame, layer.source.key);
    if (!tex) return null;
    const w = this.ss > 1 ? this.outW : this.width;
    const h = this.ss > 1 ? this.outH : this.height;
    const target = this.pool.acquire(gl, w, h);
    this.pool.clear(gl, target);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    gl.uniform1f(this.uFlipY, this.sampleFlip(source, frame, layer.source.key));
    gl.uniform1i(this.uDecode, this.sampleDecode(source, frame, layer.source.key));
    gl.uniform1f(this.uEncode, 0);
    gl.uniform1f(this.uTextGamma, layer.textGamma);
    gl.uniform2f(this.uRes, w, h);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(layer));
    gl.uniform1f(this.uOpacity, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
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
    gl.uniform1f(this.uFlipY, this.sampleFlip(source, frame, layer.source.key));
    gl.uniform1i(this.uDecode, this.sampleDecode(source, frame, layer.source.key));
    gl.uniform1f(this.uEncode, 0);
    gl.uniform1f(this.uTextGamma, layer.textGamma);
    gl.uniform2f(this.uRes, this.width, this.height);
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniformMatrix3fv(this.uModel, false, modelMatrix(this.scaled(layer)));
    gl.uniform1f(this.uOpacity, 1); // opacity applies at composite time, not here
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return target;
  }

  releaseTarget(target: RenderTarget): void {
    this.pool.release(target);
  }

  dispose(): void {
    this.resolve.dispose();
    if (this.snapTex) this.gl.deleteTexture(this.snapTex);
    if (this.snapFbo) this.gl.deleteFramebuffer(this.snapFbo);
    this.pool.dispose(this.gl);
    this.gl.deleteProgram(this.prog);
  }
}
