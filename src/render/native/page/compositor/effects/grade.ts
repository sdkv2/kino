// White balance → lift/gamma/gain → brightness/contrast/saturation. NONE of these are linear in
// alpha, so the pass un-premultiplies first and re-premultiplies after — skipping that gives every
// soft edge a dark rim, which is the bug tests/compositor-effects.test.ts's edge assertion catches.
//
// The stage ORDER is the order a colourist works in, and it is not authorable. White balance is a
// CAPTURE-side correction — a statement about what colour the light was — so it has to happen
// before anything reshapes the tone curve, or the correction is applied to an already-crushed
// image. Lift/gamma/gain is the curve. brightness/contrast/saturation is the trim on top, and it
// stays last because that is where it has always been: existing specs must not move.
//
// Inserting two stages AHEAD of the existing ones is only safe because each is skipped outright at
// its defaults. That is what the uWhiteBalanceOn / uLggOn branches are for — not an optimisation.
// `pow(c, 1.0)` and `c * 1.0` are near-neutral, not neutral, and a grade runs over every pixel of
// every frame, so "near" would show up as a moved golden hash on specs that never asked for it.
import { numParam, type EffectPass } from "./pass.js";

/** Channel gain at `temperature` ±1. 0.25 puts full warm at roughly a 1.25/0.75 red/blue split —
 *  a strong but still gradeable move, not a sepia filter. */
const WB_TEMP = 0.25;
/** Channel gain at `tint` ±1, on green. */
const WB_TINT = 0.2;

/**
 * Per-channel gains for a temperature/tint white balance.
 *
 * A channel-gain balance rather than a chromatic-adaptation transform: an author asking for
 * "warmer" wants a predictable, symmetric, invertible move, and a Bradford transform through a
 * correlated colour temperature would make `temperature: 0.5` mean something different for every
 * source white. Exported so the ratios can be asserted without a GL context.
 *
 * The gains are normalised on Rec.601 luma so a white balance moves COLOUR only. Without that,
 * `temperature` doubles as an exposure control (red carries 2.6× blue's luma weight), and every
 * temperature ramp would need a compensating `brightness` keyframe to hold its exposure.
 */
export function whiteBalanceGain(temperature: number, tint: number): [number, number, number] {
  // Exactly neutral at the defaults — not 1 ± 2e-16. The shader branch already skips this case;
  // this keeps the function itself honest for anyone reading the numbers.
  if (temperature === 0 && tint === 0) return [1, 1, 1];
  // Warm (+) lifts red and drops blue. Magenta (+) drops green and lifts red and blue by half as
  // much each, which is the axis a green/magenta tint actually runs along.
  const r = 1 + WB_TEMP * temperature + (WB_TINT / 2) * tint;
  const g = 1 - WB_TINT * tint;
  const b = 1 - WB_TEMP * temperature + (WB_TINT / 2) * tint;
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return [r / luma, g / luma, b / luma];
}

export const gradePass: EffectPass = {
  name: "grade",
  uniformNames: [
    "uWhiteBalanceOn", "uWhiteBalance",
    "uLggOn", "uLift", "uInvGamma", "uGain",
    "uBrightness", "uContrast", "uSaturation",
  ],
  frag: `
uniform float uWhiteBalanceOn;
uniform vec3 uWhiteBalance;
uniform float uLggOn;
uniform float uLift;
uniform float uInvGamma;
uniform float uGain;
uniform float uBrightness;
uniform float uContrast;
uniform float uSaturation;
void main() {
  vec4 src = kinoUnpremul(texture(uSrc, gl_FragCoord.xy / uRes));
  vec3 c = src.rgb;
  if (uWhiteBalanceOn > 0.5) c = c * uWhiteBalance;
  if (uLggOn > 0.5) {
    // in=0 lands on uLift, in=1 lands on uGain: the floor and the top are set directly rather
    // than as an offset plus a scale, which is why "lift raises the floor" stays true when gain
    // moves. The gamma then bends what is between them — pow() on a negative is undefined, and
    // uLift is allowed to go negative to crush blacks, so clamp the base first.
    c = c * (uGain - uLift) + uLift;
    c = pow(max(c, 0.0), vec3(uInvGamma));
  }
  c = c * uBrightness;
  c = (c - 0.5) * uContrast + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSaturation);
  kino_frag = kinoPremul(vec4(clamp(c, 0.0, 1.0), src.a));
}`,
  uniforms(gl, loc, params) {
    const temperature = numParam(params, "temperature", 0, -1, 1);
    const tint = numParam(params, "tint", 0, -1, 1);
    const [wr, wg, wb] = whiteBalanceGain(temperature, tint);
    gl.uniform1f(loc.uWhiteBalanceOn, temperature === 0 && tint === 0 ? 0 : 1);
    gl.uniform3f(loc.uWhiteBalance, wr, wg, wb);

    const lift = numParam(params, "lift", 0, -1, 1);
    // 0.1 rather than 0 so 1/gamma stays finite; the shader has no branch for an infinite exponent.
    const gamma = numParam(params, "gamma", 1, 0.1, 4);
    const gain = numParam(params, "gain", 1, 0, 4);
    gl.uniform1f(loc.uLggOn, lift === 0 && gamma === 1 && gain === 1 ? 0 : 1);
    gl.uniform1f(loc.uLift, lift);
    // gamma > 1 opens the midtones, matching every three-way control an author has used before.
    gl.uniform1f(loc.uInvGamma, 1 / gamma);
    gl.uniform1f(loc.uGain, gain);

    gl.uniform1f(loc.uBrightness, numParam(params, "brightness", 1, 0, 8));
    gl.uniform1f(loc.uContrast, numParam(params, "contrast", 1, 0, 8));
    gl.uniform1f(loc.uSaturation, numParam(params, "saturation", 1, 0, 8));
  },
};
