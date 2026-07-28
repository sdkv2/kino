// Cinematic finish as a post pass: edge vignette plus grain, both scaled by `intensity`.
import { numParam, type EffectPass } from "./pass.js";
import { luminance } from "../../../../filmFinish.js";

// Grain size in OUTPUT pixels. 1 means one grain per pixel.
//
// Measured against a real 35mm ProRes plate (4096x2160, area-scaled to our delivery size): the
// horizontal autocorrelation of real grain collapses at lag 1 — correlation -0.03 — so at
// 1080-class delivery film grain IS per-pixel. An earlier guess at 2.2 here was wrong; what made
// the old finish read as compression was its AMOUNT and its presence in flat blacks, not its
// fineness. Above 1 the field is interpolated on a coarser lattice, which trades accuracy for
// surviving a low-bitrate codec — grain this fine is the first thing H.264 destroys.
const GRAIN_SIZE = 1.0;
// Midtone amplitude, tuned so a flat midtone measures the same spread as the real 35mm plate
// (~3.2 at 8-bit). The old finish sat at ~6.9 — a bit over twice real film, which is most of why
// it read as noise. `grain` scales this for anyone who wants a heavier stock.
const GRAIN_GAIN = 0.545;
// Frames a grain field persists. NOTE this is a deliberate stylistic departure: the real plate
// measures a frame-to-frame correlation of 0.002, i.e. a completely fresh field every frame, as
// you would expect from a different piece of stock each time. Holding two frames halves that
// rate, which calms the boil at 30fps at the cost of accuracy. Set grainHold: 1 for what film
// actually does.
const GRAIN_HOLD = 2;

export const filmPass: EffectPass = {
  name: "film",
  uniformNames: ["uIntensity", "uLight", "uGrain", "uGrainScale", "uGrainHold"],
  frag: `
uniform float uIntensity;
uniform float uLight;
uniform float uGrain;
uniform float uGrainScale;
uniform float uGrainHold;

float kinoGrain(vec2 p, float f) {
  return fract(sin(dot(p + f * 17.0, vec2(127.1, 311.7))) * 43758.5453123);
}

// Grain has a CLUMP SIZE. Hashing per pixel gives every pixel an independent value, which is the
// signature of sensor noise and compression — not film. Interpolating a coarser lattice gives the
// noise a grain size, so neighbours are correlated the way developed silver actually is.
float kinoGrainField(vec2 p, float f) {
  vec2 i = floor(p);
  vec2 fr = fract(p);
  fr = fr * fr * (3.0 - 2.0 * fr);
  float a = kinoGrain(i, f);
  float b = kinoGrain(i + vec2(1.0, 0.0), f);
  float c = kinoGrain(i + vec2(0.0, 1.0), f);
  float d = kinoGrain(i + vec2(1.0, 1.0), f);
  return mix(mix(a, b, fr.x), mix(c, d, fr.x), fr.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uSrc, uv).rgb;
  if (uIntensity <= 0.0) { kino_frag = vec4(c, 1.0); return; }

  // Both operations below are perceptual: the vignette is "mix this far toward black" and the
  // grain is a fixed-amplitude texture. On linear values the vignette all but disappears and the
  // grain turns into visible cross-hatch in the shadows, because the encode curve is steep near
  // black. No single constant fixes both — the error depends on the underlying pixel — so the
  // pass works in gamma space and converts back on the way out.
  c = kinoToSRGB(c);

  vec2 d = (uv - vec2(0.5, 0.45));
  vec2 radii = uLight > 0.5 ? vec2(0.88, 0.76) : vec2(0.92, 0.80);
  float r = length(d / radii) * 2.0;
  float start = uLight > 0.5 ? 0.55 : 0.46;
  float t = smoothstep(start, 1.0, r);
  vec3 tint = uLight > 0.5 ? vec3(28.0, 20.0, 12.0) / 255.0 : vec3(0.0);
  float a = (uLight > 0.5 ? 0.18 : 0.46) * uIntensity * t;
  c = mix(c, tint, a);

  // Grain is a function of exposure: densest through the midtones, thinning toward the toe and
  // the shoulder. Constant-amplitude noise across the whole tonal range is the other half of why
  // this read as compression — a flat dark backdrop is exactly where a codec's noise lives, and
  // exactly where film has almost none.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float density = smoothstep(0.02, 0.45, l) * (1.0 - smoothstep(0.72, 1.0, l));

  // At size 1 the lattice IS the pixel grid, so sample the hash directly — going through the
  // interpolator would blend four taps and correlate neighbours that real grain does not.
  float seed = floor(uFrame / uGrainHold);
  float n = uGrainScale <= 1.0
    ? kinoGrain(floor(gl_FragCoord.xy), seed)
    : kinoGrainField(gl_FragCoord.xy / uGrainScale, seed);
  float g = (n - 0.5) * uGrain * density;
  kino_frag = vec4(kinoToLinear(clamp(c + g, 0.0, 1.0)), 1.0);
}`,
  uniforms(gl, loc, params) {
    const intensity = numParam(params, "intensity", 1, 0, 1);
    const night = String(params.night ?? "#0b1020");
    const light = luminance(night) > 0.5;
    // The film pass runs BEFORE the supersample resolve, so its coordinates are render pixels.
    // Scaling the lattice by ss keeps the clump size fixed in OUTPUT pixels — otherwise the
    // finish silently changes character with --quality.
    const ss = numParam(params, "ss", 1, 1, 8);
    gl.uniform1f(loc.uIntensity, intensity);
    gl.uniform1f(loc.uLight, light ? 1 : 0);
    // Interpolating the lattice halves the noise's spread, and the density curve removes more.
    // GRAIN_GAIN puts the midtone amplitude back where the flat-noise version had it, so the
    // finish is as present as before — just structured, and in the right tones.
    gl.uniform1f(loc.uGrain, (light ? 0.05 : 0.09) * intensity * GRAIN_GAIN * numParam(params, "grain", 1, 0, 4));
    gl.uniform1f(loc.uGrainScale, numParam(params, "grainSize", GRAIN_SIZE, 1, 8) * ss);
    gl.uniform1f(loc.uGrainHold, numParam(params, "grainHold", GRAIN_HOLD, 1, 8));
  },
};
