// Veiling glare: the flat wash of light that scatters inside a real lens barrel and lands on the
// whole frame, lifting the blacks and flattening contrast whenever something bright is in shot.
//
// The point of the stage is that it is CONTENT-RESPONSIVE. A constant black lift is a preset and
// reads as one; glare that appears when a highlight enters the frame and recedes when it leaves is
// what makes an audience believe there is a lens in front of the scene. So the amount is not
// authored per frame — it is measured from the frame, every frame, by post.ts reducing the
// composite to a single pixel and binding it here as `uDrive`.
//
// The model is deliberately the simple one, because the simple one is the physical one: glare is
// proportional to the TOTAL flux entering the lens, so the mean of the frame is the right driver,
// and it is added uniformly rather than shaped. Shaped scatter around a source is a different
// phenomenon with a different stage — that is `bloom`. Veiling glare is the flat component, and
// "flat" is what makes it lift blacks without touching the highlights it came from: adding 0.02 to
// a black is the whole image; adding it to a highlight is invisible.
import { numParam, type EffectPass } from "./pass.js";

/** Texture unit for the reduced frame. 0 is uSrc (runChain) and 2 is bloom's original — this takes
 *  its own so no stage has to know the order the others bound theirs in. */
export const VEIL_DRIVE_UNIT = 3;

export const veilPass: EffectPass = {
  name: "veil",
  uniformNames: ["uAmount", "uThreshold", "uDrive"],
  frag: `
uniform float uAmount;
uniform float uThreshold;
uniform sampler2D uDrive;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 src = kinoUnpremul(texture(uSrc, uv));
  if (uAmount <= 0.0) { kino_frag = kinoPremul(src); return; }

  // One texel: post.ts reduced the whole composite to it. An UNBOUND sampler reads (0,0,0,1) here,
  // which gives flux 0 and therefore no glare — the stage degrades to a no-op rather than to a
  // black frame if it is ever run without its measurement.
  vec3 mean = texture(uDrive, vec2(0.5)).rgb;
  float flux = dot(mean, vec3(0.2126, 0.7152, 0.0722));

  // The knee is on the MEAN, not per pixel: it is the author saying "an ambient level this low is
  // not enough light to scatter", which is a statement about the frame, not about a pixel.
  float drive = max(flux - uThreshold, 0.0) / max(1.0 - uThreshold, 0.0001);

  // Scene-tinted, normalised to unit luma so \`amount\` stays an exposure rather than doubling as a
  // colour control: a warm frame glares warm, a neutral frame glares neutral, and neither changes
  // how much lift \`amount\` buys. Falls back to white on a frame with no light in it at all, where
  // the division has no answer and \`drive\` is 0 anyway.
  vec3 tint = flux > 0.0001 ? mean / flux : vec3(1.0);

  kino_frag = kinoPremul(vec4(clamp(src.rgb + tint * drive * uAmount, 0.0, 1.0), src.a));
}`,
  uniforms(gl, loc, params) {
    // Real lenses veil at roughly 0.5–2% of full flux; 5% is an old uncoated one. The default sits
    // at the top of "believable" because a stage nobody switched on should not need a second
    // parameter to be visible at all.
    gl.uniform1f(loc.uAmount, numParam(params, "amount", 0.05, 0, 1));
    gl.uniform1f(loc.uThreshold, numParam(params, "threshold", 0, 0, 1));
    const drive = params._driveTex as WebGLTexture | undefined;
    if (drive) {
      gl.activeTexture(gl.TEXTURE0 + VEIL_DRIVE_UNIT);
      gl.bindTexture(gl.TEXTURE_2D, drive);
      gl.uniform1i(loc.uDrive, VEIL_DRIVE_UNIT);
    }
  },
};
