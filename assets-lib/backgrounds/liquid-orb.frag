// liquid-orb — raymarched 3D metaball. Real depth: camera orbits a lit, morphing isosurface with
// surface normals, diffuse + specular + fresnel rim, and distance fog. Author only mainImage();
// kino provides the uniforms (iResolution, iTime = frame/fps, uColorA/B/C, uIntensity 0..1, uPulse).
// Deterministic: camera + morph ride iTime (frame-derived). Brand colors light the form + ground.

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Smooth union — melts the spheres into one organic blob.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Scene SDF: three orbiting spheres fused into a metaball. Wider spread + tighter blend keeps the
// lobes visible so it reads as a morphing 3D form, not a plain sphere.
float map(vec3 p) {
  float t = iTime * 0.6;
  float r = 0.5 + 0.05 * uPulse;
  vec3 a = vec3(sin(t) * 0.7, cos(t * 0.9) * 0.55, cos(t * 1.1) * 0.45);
  vec3 b = vec3(cos(t * 1.3) * 0.72, sin(t * 0.7) * 0.6, sin(t * 0.8) * 0.45);
  vec3 c = vec3(sin(t * 0.6) * 0.55, sin(t * 1.2) * 0.72, cos(t * 0.5) * 0.55);
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

  // Soft studio background — dark brand wash so the lit form pops and captions stay legible.
  float bgf = uv.y * 0.5 + 0.5;
  vec3 bg = mix(uColorA * 0.06, uColorB * 0.11, bgf);
  bg = mix(bg, uColorC * 0.09, smoothstep(0.35, 1.0, bgf));

  // Camera orbiting the blob (rotation from iTime → real parallax on the 3D form). Pulled back with
  // a narrower FOV so the form floats as a hero with negative space; lifted up the frame (uv.y - .16)
  // so the lower third stays clean for captions.
  vec3 ro = vec3(0.0, 0.0, 4.4);
  vec3 rd = normalize(vec3(uv - vec2(0.0, 0.16), -2.0));
  float ay = iTime * 0.22;
  ro.xz *= rot(ay);
  rd.xz *= rot(ay);
  float ax = sin(iTime * 0.17) * 0.25;
  ro.yz *= rot(ax);
  rd.yz *= rot(ax);

  // Raymarch.
  float td = 0.0;
  bool hit = false;
  vec3 p = ro;
  for (int i = 0; i < 96; i++) {
    p = ro + rd * td;
    float d = map(p);
    if (d < 0.001) { hit = true; break; }
    td += d;
    if (td > 9.0) break;
  }

  vec3 col = bg;
  if (hit) {
    vec3 n = calcNormal(p);
    vec3 ld = normalize(vec3(0.7, 0.85, 0.6));
    float diff = clamp(dot(n, ld), 0.0, 1.0);
    float spec = pow(clamp(dot(reflect(-ld, n), -rd), 0.0, 1.0), 40.0);
    float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0);

    // Iridescent base: brand colors swept across the surface normal, gold hot on the rim.
    vec3 base = mix(uColorB, uColorA, n.y * 0.5 + 0.5);
    base = mix(base, uColorC, fres * 0.7);
    vec3 lit = base * (0.22 + 0.9 * diff) + spec * vec3(1.0);
    lit += uColorC * fres * 0.9;                 // fresnel rim light
    lit *= 0.85 + 0.35 * uIntensity;

    float fog = exp(-0.03 * max(td - 2.2, 0.0)); // recede into the ground with depth
    col = mix(bg, lit, fog);
  }

  // Vignette + trigger flash.
  float vig = smoothstep(1.35, 0.15, length(uv));
  col *= 0.5 + 0.62 * vig;
  col += uColorC * (0.16 * uPulse);

  fragColor = vec4(col, 1.0);
}
