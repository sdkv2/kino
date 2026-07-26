// Cinematic finish as a post pass: edge vignette plus grain, both scaled by `intensity`.
import type { EffectPass } from "./pass.js";
import { luminance } from "../../../../filmFinish.js";

export const filmPass: EffectPass = {
  name: "film",
  uniformNames: ["uIntensity", "uLight", "uGrain"],
  frag: `
uniform float uIntensity;
uniform float uLight;
uniform float uGrain;

float kinoGrain(vec2 p, float f) {
  return fract(sin(dot(p + f * 17.0, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uSrc, uv).rgb;
  if (uIntensity <= 0.0) { kino_frag = vec4(c, 1.0); return; }

  vec2 d = (uv - vec2(0.5, 0.45));
  vec2 radii = uLight > 0.5 ? vec2(0.88, 0.76) : vec2(0.92, 0.80);
  float r = length(d / radii) * 2.0;
  float start = uLight > 0.5 ? 0.55 : 0.46;
  float t = smoothstep(start, 1.0, r);
  vec3 tint = uLight > 0.5 ? vec3(28.0, 20.0, 12.0) / 255.0 : vec3(0.0);
  float a = (uLight > 0.5 ? 0.18 : 0.46) * uIntensity * t;
  c = mix(c, tint, a);

  float g = (kinoGrain(gl_FragCoord.xy, uFrame) - 0.5) * uGrain;
  kino_frag = vec4(clamp(c + g, 0.0, 1.0), 1.0);
}`,
  uniforms(gl, loc, params) {
    const intensity = Number(params.intensity ?? 1);
    const night = String(params.night ?? "#0b1020");
    const light = luminance(night) > 0.5;
    gl.uniform1f(loc.uIntensity, intensity);
    gl.uniform1f(loc.uLight, light ? 1 : 0);
    gl.uniform1f(loc.uGrain, (light ? 0.05 : 0.09) * intensity);
  },
};
