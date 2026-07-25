// aurora-flow — flowing three-color brand plasma. Author only mainImage(); kino provides the
// uniforms (iResolution, iTime = frame/fps, uColorA/B/C, uIntensity 0..1, uPulse). Deterministic:
// all motion rides iTime, which is frame-derived. Reference asset — copy into a project to tweak.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 p = (fragCoord - 0.5 * iResolution.xy) / iResolution.y; // aspect-correct, centered
  float t = iTime * (0.12 + 0.18 * uIntensity);

  float f = 0.0;
  f += sin(p.x * 3.0 + t);
  f += sin(p.y * 3.5 - t * 1.3);
  f += sin((p.x + p.y) * 2.5 + t * 0.7);
  f += sin(length(p) * 6.0 - t * 1.6);
  float m = 0.5 + 0.125 * f; // ~0..1

  vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.6, m));
  col = mix(col, uColorC, smoothstep(0.5, 1.0, m));

  float vig = smoothstep(1.2, 0.2, length(p));
  col *= 0.6 + 0.55 * vig;      // soft edge falloff
  col += uColorC * (0.12 * uPulse); // trigger flash

  fragColor = vec4(col, 1.0);
}
