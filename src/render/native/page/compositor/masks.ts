// Mask application. A masked layer is rendered to a target (Task 1), then this pass rewrites
// its alpha from a mask source before it composites.
//
// The shape SDF below is a port of src/render/shapes.ts. tests/compositor-shape-mask.test.ts
// asserts the two agree — keep them in step, or authored feather radii stop meaning px.
import type { ShapeMask } from "../../../shapes.js";
import type { ResolvedMask } from "../../../maskSpec.js";
import type { RenderTarget, TargetPool } from "./targets.js";

export const MASK_GLSL = `
// Rounded box (Inigo Quilez). Ported from shapes.ts roundedBox().
float kinoRoundedBox(vec2 p, vec2 half_, float r) {
  float rr = min(r, min(half_.x, half_.y));
  vec2 q = abs(p) - half_ + rr;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rr;
}

// Signed distance to the shape, in px. kind: 0 = rect, 1 = circle, 2 = ellipse.
float kinoShapeDist(vec2 frag, int kind, vec2 center, vec2 half_, float radius, float rotDeg) {
  vec2 d = frag - center;
  if (rotDeg != 0.0) {
    float a = radians(-rotDeg);
    float c = cos(a), s = sin(a);
    d = vec2(d.x * c - d.y * s, d.x * s + d.y * c);
  }
  if (kind == 0) return kinoRoundedBox(d, half_, radius);
  if (kind == 1) return length(d) - min(half_.x, half_.y);
  float k1 = length(d / half_);
  if (k1 == 0.0) return -min(half_.x, half_.y);
  float k2 = length(d / (half_ * half_));
  return k1 * (k1 - 1.0) / k2;
}
`;

const VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;      // the layer, already rendered
uniform sampler2D uMask;     // file/layer mask coverage (unused when uSourceKind == 0)
uniform sampler2D uMaskSdf;  // distance field for the mask, when one exists
uniform float uMaskSdfMax;   // 0 = no field this frame
uniform vec2 uRes;
uniform int uSourceKind;     // 0 = shape, 1 = file/layer texture
uniform int uChannel;        // 0..3 = rgba, 4 = luma
uniform float uFeather;
uniform float uExpand;
uniform float uInvert;
// shape params
uniform int uShapeKind;
uniform vec2 uShapeCenter;
uniform vec2 uShapeHalf;
uniform float uShapeRadius;
uniform float uShapeRot;
out vec4 kino_frag;

${MASK_GLSL}

float channelOf(vec4 c) {
  if (uChannel == 0) return c.r;
  if (uChannel == 1) return c.g;
  if (uChannel == 2) return c.b;
  if (uChannel == 3) return c.a;
  return dot(c.rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = texture(uSrc, uv);

  float coverage;
  if (uSourceKind == 0) {
    // Analytic: distance is exact, so feather is a true px band.
    float d = kinoShapeDist(gl_FragCoord.xy, uShapeKind, uShapeCenter, uShapeHalf, uShapeRadius, uShapeRot) - uExpand;
    coverage = uFeather > 0.0 ? 1.0 - smoothstep(-uFeather * 0.5, uFeather * 0.5, d)
                              : 1.0 - step(0.0, d);
  } else if (uMaskSdfMax > 0.0) {
    // A real distance field: decode, then feather in px exactly as the shape branch does.
    float d = (texture(uMaskSdf, uv).r * 2.0 - 1.0) * uMaskSdfMax - uExpand;
    coverage = uFeather > 0.0 ? 1.0 - smoothstep(-uFeather * 0.5, uFeather * 0.5, d)
                              : 1.0 - step(0.0, d);
  } else {
    // No field — fall back to raw coverage. Feather degrades to a coverage ramp, which is
    // softer than a true px band but never wrong-looking.
    float c = channelOf(texture(uMask, uv));
    coverage = uFeather > 0.0 ? smoothstep(0.5 - uFeather / 255.0, 0.5 + uFeather / 255.0, c) : step(0.5, c);
  }

  if (uInvert > 0.5) coverage = 1.0 - coverage;
  // src is premultiplied, so scaling the whole texel scales colour and alpha together.
  kino_frag = src * coverage;
}`;

export interface MaskBinding {
  /** Coverage texture for file/layer masks; null for shape masks. */
  mask: WebGLTexture | null;
  /** Distance field for the mask, when one was written for this frame. */
  sdf: WebGLTexture | null;
  /** Encode half-range in px, or 0 when there is no field this frame. */
  sdfMax: number;
}

const CHANNEL_INDEX: Record<string, number> = { r: 0, g: 1, b: 2, a: 3, luma: 4 };

let program: { gl: WebGL2RenderingContext; prog: WebGLProgram; loc: Record<string, WebGLUniformLocation | null> } | null = null;

function ensureProgram(gl: WebGL2RenderingContext) {
  if (program && program.gl === gl) return program;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`mask shader failed to compile: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`mask program failed to link: ${gl.getProgramInfoLog(prog)}`);
  }
  const names = ["uSrc", "uMask", "uMaskSdf", "uMaskSdfMax", "uRes", "uSourceKind", "uChannel",
    "uFeather", "uExpand", "uInvert", "uShapeKind", "uShapeCenter", "uShapeHalf", "uShapeRadius", "uShapeRot"];
  const loc: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) loc[n] = gl.getUniformLocation(prog, n);
  program = { gl, prog, loc };
  return program;
}

const SHAPE_KIND: Record<string, number> = { rect: 0, circle: 1, ellipse: 2 };

/** Mask `src` into a fresh target. The caller releases both. */
export function applyMask(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  src: RenderTarget,
  mask: ResolvedMask,
  binding: MaskBinding,
): RenderTarget {
  const { prog, loc } = ensureProgram(gl);
  const out = pool.acquire(gl, src.w, src.h);
  pool.clear(gl, out);

  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
  gl.viewport(0, 0, out.w, out.h);
  gl.disable(gl.BLEND);
  gl.useProgram(prog);
  gl.uniform2f(loc.uRes, out.w, out.h);
  gl.uniform1f(loc.uFeather, mask.feather);
  gl.uniform1f(loc.uExpand, mask.expand);
  gl.uniform1f(loc.uInvert, mask.invert ? 1 : 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.uniform1i(loc.uSrc, 0);

  if (mask.source.kind === "shape") {
    const s: ShapeMask = mask.source.shape;
    gl.uniform1i(loc.uSourceKind, 0);
    gl.uniform1i(loc.uShapeKind, SHAPE_KIND[s.kind] ?? 0);
    gl.uniform2f(loc.uShapeCenter, s.x + s.w / 2, s.y + s.h / 2);
    gl.uniform2f(loc.uShapeHalf, s.w / 2, s.h / 2);
    gl.uniform1f(loc.uShapeRadius, s.radius ?? 0);
    gl.uniform1f(loc.uShapeRot, s.rotate ?? 0);
    gl.uniform1f(loc.uMaskSdfMax, 0);
  } else {
    gl.uniform1i(loc.uSourceKind, 1);
    gl.uniform1i(loc.uChannel, CHANNEL_INDEX[mask.source.channel] ?? 4);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, binding.mask);
    gl.uniform1i(loc.uMask, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, binding.sdf);
    gl.uniform1i(loc.uMaskSdf, 2);
    gl.uniform1f(loc.uMaskSdfMax, binding.sdfMax);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE0);
  return out;
}

/** Test hook: render the shape SDF for a list of sample points and read the values back, so
 *  the GLSL can be compared against shapes.ts numerically. */
export function probeShapeDistance(
  canvas: HTMLCanvasElement,
  samples: Array<[ShapeMask, number, number]>,
): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const out: number[] = [];
  const PROBE_FRAG = `#version 300 es
precision highp float;
uniform int uShapeKind; uniform vec2 uShapeCenter; uniform vec2 uShapeHalf;
uniform float uShapeRadius; uniform float uShapeRot; uniform vec2 uSample;
out vec4 kino_frag;
${MASK_GLSL}
void main() {
  float d = kinoShapeDist(uSample, uShapeKind, uShapeCenter, uShapeHalf, uShapeRadius, uShapeRot);
  // Encode ±512px into 0..1 so an 8-bit read-back still resolves under a pixel.
  kino_frag = vec4((d / 1024.0) + 0.5, 0.0, 0.0, 1.0);
}`;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PROBE_FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const px = new Uint8Array(4);
  for (const [shape, sx, sy] of samples) {
    gl.uniform1i(gl.getUniformLocation(prog, "uShapeKind"), SHAPE_KIND[shape.kind] ?? 0);
    gl.uniform2f(gl.getUniformLocation(prog, "uShapeCenter"), shape.x + shape.w / 2, shape.y + shape.h / 2);
    gl.uniform2f(gl.getUniformLocation(prog, "uShapeHalf"), shape.w / 2, shape.h / 2);
    gl.uniform1f(gl.getUniformLocation(prog, "uShapeRadius"), shape.radius ?? 0);
    gl.uniform1f(gl.getUniformLocation(prog, "uShapeRot"), shape.rotate ?? 0);
    gl.uniform2f(gl.getUniformLocation(prog, "uSample"), sx, sy);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    out.push((px[0] / 255 - 0.5) * 1024);
  }
  return out;
}
