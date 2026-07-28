// Bright-pass, blur, add back. Additive light around the bright parts of a layer.
import { numParam, type EffectPass } from "./pass.js";

export const glowPass: EffectPass = {
  name: "glow",
  uniformNames: ["uRadius", "uIntensity", "uThreshold"],
  frag: `
uniform float uRadius;
uniform float uIntensity;
uniform float uThreshold;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = texture(uSrc, uv);
  if (uIntensity <= 0.0) { kino_frag = src; return; }
  vec2 texel = 1.0 / uRes;
  vec3 bloom = vec3(0.0);
  float wsum = 0.0;
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -6; i <= 6; i++) {
    for (int j = -6; j <= 6; j++) {
      vec2 off = vec2(float(i), float(j)) * (uRadius / 6.0);
      vec4 s = texture(uSrc, uv + off * texel);
      // Bright pass on unpremultiplied colour so a faint-but-bright edge still contributes.
      vec3 lit = kinoUnpremul(s).rgb;
      float l = dot(lit, vec3(0.299, 0.587, 0.114));
      float keep = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);
      float w = exp(-dot(off, off) / (2.0 * sigma * sigma));
      bloom += lit * keep * s.a * w;
      wsum += w;
    }
  }
  bloom = bloom / max(wsum, 0.0001) * uIntensity;
  // Additive: light adds, it does not occlude.
  kino_frag = vec4(src.rgb + bloom, max(src.a, min(1.0, dot(bloom, vec3(0.333)))));
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uRadius, numParam(params, "radius", 8, 0, 256));
    gl.uniform1f(loc.uIntensity, numParam(params, "intensity", 1, 0, 8));
    // 0.32 linear == 0.60 sRGB: the perceptual cut this pass had before compositing moved to
    // linear light. Thresholds are luminance in the working space, so the number had to move
    // even though the intent did not.
    gl.uniform1f(loc.uThreshold, numParam(params, "threshold", 0.32, 0, 1));
  },
};
