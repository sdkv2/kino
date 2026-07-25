// Brightness / contrast / saturation. NONE of these are linear in alpha, so the pass
// un-premultiplies first and re-premultiplies after — skipping that gives every soft edge a
// dark rim, which is the bug tests/compositor-effects.test.ts's edge assertion catches.
import type { EffectPass } from "./pass.js";

export const gradePass: EffectPass = {
  name: "grade",
  uniformNames: ["uBrightness", "uContrast", "uSaturation"],
  frag: `
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
void main() {
  vec4 src = kinoUnpremul(texture(uSrc, gl_FragCoord.xy / uRes));
  vec3 c = src.rgb * uBrightness;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation);
  kino_frag = kinoPremul(vec4(clamp(c, 0.0, 1.0), src.a));
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uBrightness, Number(params.brightness ?? 1));
    gl.uniform1f(loc.uContrast, Number(params.contrast ?? 1));
    gl.uniform1f(loc.uSaturation, Number(params.saturation ?? 1));
  },
};
