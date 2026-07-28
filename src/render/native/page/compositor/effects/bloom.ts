// Frame-level bloom: bright-pass, separable blur, add back.
import type { EffectPass } from "./pass.js";

const BLOOM_FRAG = `
uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;
uniform vec2 uAxis;
uniform float uComposite;
uniform sampler2D uOriginal;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uIntensity <= 0.0) { kino_frag = texture(uSrc, uv); return; }

  if (uComposite > 0.5) {
    vec3 base = texture(uOriginal, uv).rgb;
    vec3 bloom = texture(uSrc, uv).rgb * uIntensity;
    kino_frag = vec4(base + bloom, 1.0);
    return;
  }

  vec2 texel = uAxis / uRes;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  float sigma = max(uRadius * 0.5, 0.0001);
  for (int i = -12; i <= 12; i++) {
    float o = float(i) * (uRadius / 12.0);
    vec3 s = texture(uSrc, uv + texel * o).rgb;
    float l = dot(s, vec3(0.299, 0.587, 0.114));
    float keep = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);
    float w = exp(-(o * o) / (2.0 * sigma * sigma));
    sum += s * keep * w;
    wsum += w;
  }
  kino_frag = vec4(sum / max(wsum, 0.0001), 1.0);
}`;

export const bloomPass: EffectPass = {
  name: "bloom",
  uniformNames: ["uThreshold", "uIntensity", "uRadius", "uAxis", "uComposite", "uOriginal"],
  frag: BLOOM_FRAG,
  uniforms(gl, loc, params) {
    // 0.45 linear == 0.70 sRGB — see the note in glow.ts.
    gl.uniform1f(loc.uThreshold, Number(params.threshold ?? 0.45));
    gl.uniform1f(loc.uIntensity, Number(params.intensity ?? 0.4));
    gl.uniform1f(loc.uRadius, Number(params.radius ?? 24));
    const axis = String(params.axis ?? "x");
    gl.uniform2f(loc.uAxis, axis === "x" ? 1 : 0, axis === "y" ? 1 : 0);
    gl.uniform1f(loc.uComposite, axis === "composite" ? 1 : 0);
    if (axis === "composite" && params._originalTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, params._originalTex as WebGLTexture);
      gl.uniform1i(loc.uOriginal, 2);
    }
  },
};
