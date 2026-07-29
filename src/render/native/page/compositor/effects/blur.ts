// Gaussian blur with an optional focal region — the 2D stand-in for depth of field.
//
// Single-pass with a fixed tap count rather than separable two-pass: a layer effect runs on a
// full-frame target, and the second pass would double the target churn for a quality gain that
// is invisible at the radii layer effects use. Phase 3's bloom uses the separable form, where
// the radii are large enough to matter.
//
// The focal region varies the radius PER PIXEL inside that same fixed loop, so tap count — and
// therefore cost — is unchanged, and the sharp region early-outs. Known artifact: taps in the
// blurred region still reach into the sharp region, so sharpness bleeds slightly outward across
// the focal boundary. That is the standard cheap-DOF trade; removing it needs a depth-aware
// gather, which this pass has no depth to do.
import { numParam, type EffectPass } from "./pass.js";

export const blurPass: EffectPass = {
  name: "blur",
  uniformNames: [
    "uRadius", "uFocusX", "uFocusY", "uFocusRadius", "uFocusFeather",
    "uFalloff", "uFocusMode", "uFocusAngle",
  ],
  frag: `
uniform float uRadius;
uniform float uFocusX;
uniform float uFocusY;
uniform float uFocusRadius;
uniform float uFocusFeather;
uniform float uFalloff;
uniform int uFocusMode;
uniform float uFocusAngle;

// 0 at the focal centre, 1 at full defocus. Distances are in units of frame HEIGHT, with x
// corrected by aspect, so a radial region is a circle on a 9:16 frame rather than an ellipse.
//
// gl_FragCoord.y runs BOTTOM-UP over the layer target, so the raw uv.y here is a fraction from the
// bottom of the frame. focusY is authored as a fraction from the TOP, like every other coordinate
// in the spec, so it is flipped — and ONLY here. The blur's own sampling uv must stay untouched:
// it reads and writes the same target, where the orientation cancels out.
// tests/compositor-orientation.test.ts pins this in both directions.
float defocus(vec2 uv) {
  if (uFocusRadius <= 0.0) return 1.0;
  vec2 focusUv = vec2(uv.x, 1.0 - uv.y);
  vec2 delta = (focusUv - vec2(uFocusX, uFocusY)) * vec2(uRes.x / uRes.y, 1.0);
  float d = uFocusMode == 1
    // Band (tilt-shift): perpendicular distance from the line through the focal point.
    ? abs(dot(delta, vec2(-sin(uFocusAngle), cos(uFocusAngle))))
    : length(delta);
  return pow(smoothstep(uFocusRadius, uFocusRadius + uFocusFeather, d), uFalloff);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float r = uRadius * defocus(uv);
  if (r <= 0.0) { kino_frag = texture(uSrc, uv); return; }
  vec2 texel = 1.0 / uRes;
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  // 13 taps over ±r, Gaussian-weighted. sigma = r/2 puts ~95% of the kernel inside.
  float sigma = max(r * 0.5, 0.0001);
  for (int i = -6; i <= 6; i++) {
    for (int j = -6; j <= 6; j++) {
      vec2 off = vec2(float(i), float(j)) * (r / 6.0);
      float w = exp(-dot(off, off) / (2.0 * sigma * sigma));
      sum += texture(uSrc, uv + off * texel) * w;
      wsum += w;
    }
  }
  kino_frag = sum / max(wsum, 0.0001);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uRadius, numParam(params, "radius", 0, 0, 256));
    gl.uniform1f(loc.uFocusX, numParam(params, "focusX", 0.5, -4, 4));
    gl.uniform1f(loc.uFocusY, numParam(params, "focusY", 0.5, -4, 4));
    gl.uniform1f(loc.uFocusRadius, numParam(params, "focusRadius", 0, 0, 8));
    // Minimum is 0.0001, not 0: a zero feather makes smoothstep's two edges equal, which is
    // undefined in GLSL.
    gl.uniform1f(loc.uFocusFeather, numParam(params, "focusFeather", 0.35, 0.0001, 8));
    gl.uniform1f(loc.uFalloff, numParam(params, "falloff", 1, 0.05, 16));
    gl.uniform1i(loc.uFocusMode, params.focusMode === "band" ? 1 : 0);
    gl.uniform1f(loc.uFocusAngle, (numParam(params, "focusAngle", 0, -360, 360) * Math.PI) / 180);
  },
};
