// Barrel/pincushion distortion with per-channel chromatic aberration.
import { numParam, type EffectPass } from "./pass.js";

export const lensPass: EffectPass = {
  name: "lens",
  uniformNames: ["uDistortion", "uChroma"],
  frag: `
uniform float uDistortion;
uniform float uChroma;

vec2 kinoDistort(vec2 uv, float k) {
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  return 0.5 + c * (1.0 + k * r2);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uDistortion == 0.0 && uChroma == 0.0) { kino_frag = texture(uSrc, uv); return; }
  vec2 ruv = kinoDistort(uv, uDistortion + uChroma);
  vec2 guv = kinoDistort(uv, uDistortion);
  vec2 buv = kinoDistort(uv, uDistortion - uChroma);
  kino_frag = vec4(
    texture(uSrc, clamp(ruv, 0.0, 1.0)).r,
    texture(uSrc, clamp(guv, 0.0, 1.0)).g,
    texture(uSrc, clamp(buv, 0.0, 1.0)).b,
    1.0);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uDistortion, numParam(params, "distortion", 0, -1, 1));
    gl.uniform1f(loc.uChroma, numParam(params, "chroma", 0, 0, 1));
  },
};
