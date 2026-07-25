// orb-badge — liquid-orb metaball with a texture channel (uTex0) wrapped around the primary lobe
// as a rotating cylindrical decal. Pair with spec `backgroundTextures: ["motion/badge.html"]` —
// the rasterized DOM element bends around the 3D surface, occludes correctly, and picks up the
// form's lighting. Deterministic: camera, morph and band spin all ride iTime (frame-derived).
// uTexSize0 is (0,0) when no texture is bound — the decal simply disappears.

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// Primary lobe center — the badge rides this ball. Shared by map() and the decal mapping.
vec3 ballA(float t) { return vec3(sin(t) * 0.7, cos(t * 0.9) * 0.55, cos(t * 1.1) * 0.45); }

float map(vec3 p) {
  float t = iTime * 0.6;
  float r = 0.5 + 0.05 * uPulse;
  vec3 a = ballA(t);
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

// Cylindrical decal around the primary lobe: longitude → u (one full wrap, spinning with time),
// height → v. Returns straight-alpha rgba; alpha fades where the surface leaves the lobe.
vec4 decal(vec3 p) {
  if (uTexSize0.x < 1.0) return vec4(0.0);
  float t = iTime * 0.6;
  vec3 q = p - ballA(t);
  float r = 0.5;
  // Band height keeps the texture's aspect over one circumference wrap.
  float bandH = 6.28318 * r * (uTexSize0.y / uTexSize0.x) * 0.5; // aspect over a half wrap (2 copies)
  float phi = atan(q.x, q.z) + iTime * 0.55; // spin the label around the ball
  float u = fract((phi / 6.28318) * 2.0 + 0.5); // 2 copies around the circumference
  float v = q.y / bandH + 0.5;
  if (v < 0.0 || v > 1.0) return vec4(0.0);
  vec4 tex = texture(uTex0, vec2(u, v));
  // Fade the decal off where the surface belongs to the other lobes.
  float near = smoothstep(r + 0.42, r + 0.1, length(q));
  return vec4(tex.rgb, tex.a * near);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;

  float bgf = uv.y * 0.5 + 0.5;
  vec3 bg = mix(uColorA * 0.06, uColorB * 0.11, bgf);
  bg = mix(bg, uColorC * 0.09, smoothstep(0.35, 1.0, bgf));

  vec3 ro = vec3(0.0, 0.0, 4.4);
  vec3 rd = normalize(vec3(uv - vec2(0.0, 0.16), -2.0));
  float ay = iTime * 0.22;
  ro.xz *= rot(ay);
  rd.xz *= rot(ay);
  float ax = sin(iTime * 0.17) * 0.25;
  ro.yz *= rot(ax);
  rd.yz *= rot(ax);

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

    vec3 base = mix(uColorB, uColorA, n.y * 0.5 + 0.5);
    base = mix(base, uColorC, fres * 0.7);

    vec3 lit = base * (0.22 + 0.9 * diff) + spec * vec3(1.0);
    lit += uColorC * fres * 0.9;
    lit *= 0.85 + 0.35 * uIntensity;

    // Wrap the DOM decal on AFTER lighting with partial shading, so the UI stays legible on the
    // dark side while still curving + speccing like it sits on the surface.
    vec4 dec = decal(p);
    vec3 decLit = dec.rgb * (0.62 + 0.38 * diff) + spec * vec3(0.6);
    lit = mix(lit, decLit, dec.a * 0.95);

    float fog = exp(-0.03 * max(td - 2.2, 0.0));
    col = mix(bg, lit, fog);
  }

  float vig = smoothstep(1.35, 0.15, length(uv));
  col *= 0.5 + 0.62 * vig;
  col += uColorC * (0.16 * uPulse);

  fragColor = vec4(col, 1.0);
}
