// Directional smear along a motion vector. Alpha-linear — averages premultiplied taps directly,
// same contract as blur.ts. A weighted average of premultiplied colours is still premultiplied.
//
// Tap count is fixed in the shader (MAX_TAPS) with a uniform early-out so every frame is
// deterministic: no clock, no hash jitter, same inputs → same pixels.
import { numParam, type EffectPass } from "./pass.js";

const MAX_DISTANCE = 256;
const DEFAULT_SAMPLES = 8;
const MAX_SAMPLES = 32;

export const motionBlurPass: EffectPass = {
  name: "motionBlur",
  uniformNames: ["uAngle", "uDistance", "uSamples", "uRadial"],
  frag: `
uniform float uAngle;
uniform float uDistance;
uniform int uSamples;
uniform float uRadial;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uDistance <= 0.0 && uRadial <= 0.0) { kino_frag = texture(uSrc, uv); return; }

  vec2 texel = 1.0 / uRes;
  // Two motions in one smear. A pan moves every pixel by the same vector; a scale change moves
  // each pixel along its own ray from the centre, proportionally to how far out it already is.
  // Summing them is exactly what an affine camera does between two frames.
  vec2 dir = vec2(cos(uAngle), sin(uAngle)) * uDistance * texel + (uv - 0.5) * uRadial;
  int n = uSamples;
  vec4 sum = vec4(0.0);
  // Centred box filter: taps span [-0.5, +0.5] of the smear vector so the blur is symmetric
  // around the pixel, not biased toward the motion tail.
  for (int i = 0; i < 32; i++) {
    if (i >= n) break;
    float t = (float(i) + 0.5) / float(n) - 0.5;
    sum += texture(uSrc, uv + dir * t);
  }
  kino_frag = sum / float(n);
}`,
  uniforms(gl, loc, params) {
    const distance = numParam(params, "distance", 0, 0, MAX_DISTANCE);
    const angleRad = (numParam(params, "angle", 0) * Math.PI) / 180;
    const samples = Math.round(numParam(params, "samples", DEFAULT_SAMPLES, 1, MAX_SAMPLES));
    gl.uniform1f(loc.uAngle, angleRad);
    gl.uniform1f(loc.uDistance, distance);
    gl.uniform1i(loc.uSamples, samples);
    gl.uniform1f(loc.uRadial, numParam(params, "radial", 0, -1, 1));
  },
};
