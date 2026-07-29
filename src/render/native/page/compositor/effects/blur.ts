// Gaussian blur. Alpha-linear, so it operates on premultiplied values directly.
//
// Single-pass with a fixed tap count rather than separable two-pass: a layer effect runs on a
// full-frame target, and the second pass would double the target churn for a quality gain that
// is invisible at the radii layer effects use. Phase 3's bloom uses the separable form, where
// the radii are large enough to matter.
import { numParam, type EffectPass } from "./pass.js";

export const blurPass: EffectPass = {
  name: "blur",
  uniformNames: ["uRadius"],
  frag: `
uniform float uRadius;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uRadius <= 0.0) { kino_frag = texture(uSrc, uv); return; }
  vec2 texel = 1.0 / uRes;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  // 13 taps over ±radius, Gaussian-weighted. sigma = radius/2 puts ~95% of the kernel inside.
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -6; i <= 6; i++) {
    for (int j = -6; j <= 6; j++) {
      vec2 off = vec2(float(i), float(j)) * (uRadius / 6.0);
      float w = exp(-dot(off, off) / (2.0 * sigma * sigma));
      sum += texture(uSrc, uv + off * texel) * w;
      wsum += w;
    }
  }
  kino_frag = sum / max(wsum, 0.0001);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uRadius, numParam(params, "radius", 0, 0, 256));
  },
};
