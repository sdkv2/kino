// Frame-level bloom: bright-pass, separable blur, add back. `halation` gives the blur a
// per-channel width so red bleeds furthest — see the note on the loop.
import { numParam, type EffectPass } from "./pass.js";

const BLOOM_FRAG = `
uniform float uThreshold;
uniform float uIntensity;
uniform float uRadius;
uniform float uHalation;
uniform vec2 uAxis;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  if (uIntensity <= 0.0) { kino_frag = texture(uSrc, uv); return; }

  vec2 texel = uAxis / uRes;
  float sigma = max(uRadius * 0.5, 0.0001);

  // Halation is three sigmas, not three blurs. Real halation is light scattering back off the film
  // base, and long wavelengths travel furthest through the emulsion before they do — so red bleeds
  // widest and blue barely at all. That is a per-CHANNEL radius, which this loop can carry for
  // free: it already accumulates a vec3, so making the weights a vec3 costs three exp() calls and
  // ZERO extra texture reads. A second blur pass would double the fill; a chromatic uv-scale in
  // the composite step would be radial rather than local, i.e. chromatic aberration — which is
  // what postFx.lens.chroma already is.
  //
  // The taps have to SPAN the widest sigma or red gets truncated at exactly the distance halation
  // is supposed to reach, so the span scales with red's multiplier. Both this and the weights are
  // behind the branch: at halation 0, span is uRadius untouched and every component of sig is
  // sigma itself, so the loop reduces term-for-term to the scalar version it replaced.
  vec3 sig = vec3(sigma);
  float span = uRadius;
  if (uHalation > 0.0) {
    sig = sigma * vec3(1.0 + uHalation, 1.0 - 0.2 * uHalation, 1.0 - 0.45 * uHalation);
    span = uRadius * (1.0 + uHalation);
  }

  vec3 sum = vec3(0.0);
  vec3 wsum = vec3(0.0);
  float tapStep = span / 12.0;
  for (int i = -12; i <= 12; i++) {
    float o = float(i) * tapStep;
    vec3 s = texture(uSrc, uv + texel * o).rgb;
    float l = dot(s, vec3(0.299, 0.587, 0.114));
    float keep = max(l - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);
    vec3 w = exp(-(o * o) / (2.0 * sig * sig));
    sum += s * keep * w;
    wsum += w;
  }
  // Per-channel normalisation: halation REDISTRIBUTES a channel's energy outward, it does not add
  // any. Without this, widening red would also brighten it and the effect would read as a colour
  // cast rather than a spread.
  kino_frag = vec4(sum / max(wsum, vec3(0.0001)), 1.0);
}`;

export const bloomPass: EffectPass = {
  name: "bloom",
  uniformNames: ["uThreshold", "uIntensity", "uRadius", "uHalation", "uAxis"],
  frag: BLOOM_FRAG,
  uniforms(gl, loc, params) {
    // 0.45 linear == 0.70 sRGB — see the note in glow.ts.
    gl.uniform1f(loc.uThreshold, numParam(params, "threshold", 0.45, 0, 1));
    gl.uniform1f(loc.uIntensity, numParam(params, "intensity", 0.4, 0, 8));
    gl.uniform1f(loc.uRadius, numParam(params, "radius", 24, 0, 256));
    gl.uniform1f(loc.uHalation, numParam(params, "halation", 0, 0, 1));
    const axis = String(params.axis ?? "x");
    gl.uniform2f(loc.uAxis, axis === "x" ? 1 : 0, axis === "y" ? 1 : 0);
  },
};

/**
 * The add-back, as its OWN program.
 *
 * It used to be a third branch inside the blur shader, selected by a `uComposite` flag. That
 * shader then had two samplers used in mutually exclusive branches with a 25-tap loop below them,
 * and on the ANGLE/Metal backend the `uSrc` fetch in the composite branch returned zero whenever
 * `uOriginal` was also sampled — so `base + bloom` evaluated to `base` and `postFx.bloom` was a
 * no-op in every real render, while its unit tests (which only ever ran the `axis: "x"` blur)
 * stayed green.
 *
 * Sampling uSrc alone in that branch read correct values; adding the uOriginal fetch beside it
 * zeroed it. Splitting the add-back out removes the divergent-branch-plus-loop shape entirely:
 * this program has no loop and no branch, which is also what it always should have been — the
 * composite step shares nothing with the blur but its inputs.
 */
export const bloomCompositePass: EffectPass = {
  name: "bloomComposite",
  uniformNames: ["uIntensity", "uOriginal"],
  frag: `
uniform float uIntensity;
uniform sampler2D uOriginal;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 base = texture(uOriginal, uv).rgb;
  vec3 bloom = texture(uSrc, uv).rgb * uIntensity;
  kino_frag = vec4(base + bloom, 1.0);
}`,
  uniforms(gl, loc, params) {
    gl.uniform1f(loc.uIntensity, numParam(params, "intensity", 0.4, 0, 8));
    if (params._originalTex) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, params._originalTex as WebGLTexture);
      gl.uniform1i(loc.uOriginal, 2);
    }
  },
};
