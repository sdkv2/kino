// liquid-glass — raymarched refractive glass drop. A morphing isosurface refracts + reflects a
// colorful procedural environment, with per-channel chromatic dispersion, a fresnel reflection rim,
// and a specular hotspot (the "liquid glass" look). Author only mainImage(); kino provides the
// uniforms (iResolution, iTime = frame/fps, uColorA/B/C, uIntensity, uPulse). Deterministic: the
// morph, camera orbit, and env lights all ride iTime (frame-derived).

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The environment the glass bends. High-contrast + saturated with sharp features, so the refraction
// visibly distorts it and the chromatic dispersion fringes on the hard edges (a smooth wash reads as
// frosted mud instead of glass).
vec3 envColor(vec3 rd) {
  float t = iTime * 0.15;
  vec2 q = rd.xy * rot(t * 0.25);
  // Bold cyan↔magenta split along a wavy diagonal (full saturation — the drop transmits this).
  float g = smoothstep(-0.55, 0.55, q.x * 0.8 + q.y + sin(q.y * 4.0 + t) * 0.28);
  vec3 c = mix(uColorA, uColorB, g);
  // Gold light streaks — sharp bands give the dispersion something to split on.
  float streak = smoothstep(0.72, 1.0, sin(q.x * 5.5 - q.y * 3.5 + t * 1.4) * 0.5 + 0.5);
  c = mix(c, uColorC, streak * 0.75);
  // Small bright hotspot (kept tight so the drop transmits color, not a milky white-out).
  c += vec3(1.0) * smoothstep(0.24, 0.0, length(q - vec2(0.33, 0.42))) * 0.4;
  return c * 1.08; // punch saturation/brightness of the transmitted field
}

// Glass SDF: three orbiting spheres fused into a morphing liquid drop.
float map(vec3 p) {
  float t = iTime * 0.5;
  float r = 0.55 + 0.05 * uPulse;
  vec3 a = vec3(sin(t) * 0.58, cos(t * 0.9) * 0.42, cos(t * 1.1) * 0.4);
  vec3 b = vec3(cos(t * 1.2) * 0.6, sin(t * 0.7) * 0.52, sin(t * 0.8) * 0.4);
  vec3 c = vec3(sin(t * 0.6) * 0.44, sin(t * 1.3) * 0.58, cos(t * 0.5) * 0.5);
  float d = length(p - a) - r;
  d = smin(d, length(p - b) - r, 0.5);
  d = smin(d, length(p - c) - r * 0.9, 0.5);
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0012, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)));
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

  // Camera orbit; lift the drop up the frame so the lower third stays legible.
  vec3 ro = vec3(0.0, 0.0, 4.2);
  vec3 rd = normalize(vec3(uv - vec2(0.0, 0.13), -2.0));
  float ay = iTime * 0.18;
  ro.xz *= rot(ay);
  rd.xz *= rot(ay);

  vec3 bg = envColor(rd) * 0.78; // background behind the glass

  float td = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 90; i++) {
    p = ro + rd * td;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    td += d;
    if (td > 9.0) break;
  }

  vec3 col = bg;
  if (hit) {
    vec3 n = calcNormal(p);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);

    // Reflection off the surface (mirrors the environment on the rim).
    vec3 refl = envColor(reflect(rd, n));

    // Refraction through the front surface, sampled at three IORs → visible chromatic dispersion.
    float e = 1.0 / 1.48;
    vec3 refr = vec3(
      envColor(refract(rd, n, e * 0.92)).r,
      envColor(refract(rd, n, e)).g,
      envColor(refract(rd, n, e * 1.08)).b);
    refr *= mix(vec3(1.0), uColorC * 1.15 + 0.5, 0.08); // barely-there tint — keep the glass clear

    vec3 glass = mix(refr, refl, clamp(fres, 0.0, 1.0)); // refraction body, reflection rim

    vec3 ld = normalize(vec3(0.6, 0.85, 0.6));
    float spec = pow(clamp(dot(reflect(-ld, n), -rd), 0.0, 1.0), 90.0);
    glass += vec3(1.0) * spec * 1.6;     // sharp white glass highlight
    glass += vec3(1.0) * fres * 0.35;    // bright fresnel edge (glassy sheen)
    glass += uColorC * fres * 0.35;      // warm color in the rim
    glass *= 0.9 + 0.3 * uIntensity;
    col = glass;
  }

  // Keep the lower third darker for caption legibility + vignette + pulse flash.
  col *= mix(0.5, 1.0, smoothstep(-0.62, -0.05, uv.y));
  float vig = smoothstep(1.4, 0.2, length(uv));
  col *= 0.72 + 0.4 * vig;
  col += uColorC * (0.12 * uPulse);

  fragColor = vec4(col, 1.0);
}
