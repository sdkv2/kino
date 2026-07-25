// One fragment pass over a rendered layer. Every per-layer effect and every phase-3 post-FX
// stage is one of these, so they share compilation, ping-pong and uniform plumbing.
//
// Values arriving in `uSrc` are PREMULTIPLIED. A pass that is linear in alpha (blur, add) can
// work on them directly; anything that is not (saturation, gamma, contrast) must un-premultiply
// first and re-premultiply after, or dark halos appear around every soft edge.
export interface EffectPass {
  name: string;
  /** Fragment source. Receives `uniform sampler2D uSrc`, `uniform vec2 uRes`,
   *  `uniform float uFrame`, plus whatever this pass declares. */
  frag: string;
  /** Set this pass's own uniforms. `loc` is pre-resolved by name. */
  uniforms(
    gl: WebGL2RenderingContext,
    loc: Record<string, WebGLUniformLocation | null>,
    params: Record<string, number | string>,
    frame: number,
  ): void;
  /** Uniform names to resolve for `loc`. */
  uniformNames?: string[];
}

export const PASS_PREAMBLE = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uRes;
uniform float uFrame;
out vec4 kino_frag;

vec4 kinoUnpremul(vec4 c) { return c.a > 0.0 ? vec4(c.rgb / c.a, c.a) : c; }
vec4 kinoPremul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
`;
