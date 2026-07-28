#version 300 es
// liquid-glass — default kino-lens material (Apple-style edge refraction).
// Required uniforms: uBg, uShape, uBgRect, uIsFullBg, uUseShape, uSize, uRadius, uRadii,
// uBand, uStrength, uChroma, uProfile, uFilm, uSaturate, uBrightness, uFrost, uEdgeBlur, uSS, uSdfMax,
// uLayerPass, uPageOrigin, uLayerDevSize, uDevScale
// Shape mask R = encoded signed distance (0.5 edge, IQ +outside); A = silhouette.
// uRadii = CSS corner order (TL, TR, BR, BL). uRadius kept as max(corners) for legacy.
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uShape;
uniform vec4 uBgRect;
uniform float uIsFullBg;
uniform float uUseShape;
uniform vec2 uSize;
uniform float uRadius;
uniform vec4 uRadii;
uniform float uBand;
uniform float uStrength;
uniform float uChroma;
uniform float uProfile;
uniform vec4 uFilm;
uniform float uSaturate;
uniform float uBrightness;
uniform float uFrost;
uniform float uEdgeBlur;
uniform float uSS;
uniform float uSdfMax;
uniform float uLayerPass;
uniform vec2 uPageOrigin;
uniform vec2 uLayerDevSize;
uniform float uDevScale;
out vec4 outColor;

/** Uniform round-rect SDF (Y-down px). */
float sdRoundRectR(vec2 p, vec2 halfSize, float r) {
  r = min(r, min(halfSize.x, halfSize.y));
  vec2 q = abs(p - halfSize) - halfSize + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

/**
 * Silhouette SDF. Asymmetric CSS radii bake a shape mask instead (see resolveGlassShapePlan) —
 * analytic multi-radius quadrant-select kinks ∇SDF into wedges.
 */
float sdRoundRectCss(vec2 p, vec2 halfSize, vec4 radiiCss) {
  return sdRoundRectR(p, halfSize, max(max(radiiCss.x, radiiCss.y), max(radiiCss.z, radiiCss.w)));
}

float maskShapeSd(vec2 p) {
  vec2 uv = vec2(p.x / uSize.x, 1.0 - p.y / uSize.y);
  float e = texture(uShape, clamp(uv, vec2(0.001), vec2(0.999))).r;
  return (e - 0.5) * 2.0 * max(uSdfMax, 1.0);
}

float shapeSd(vec2 p) {
  if (uUseShape > 0.5) return maskShapeSd(p);
  return sdRoundRectCss(p, 0.5 * uSize, uRadii);
}

/**
 * Bevel field the refraction rides on. Distance-to-silhouette is only C1 while the bevel stays
 * inside the corner arc: past d = cornerRadius its offset curves collapse onto the corner
 * diagonal (a picture-frame miter), ∇SDF snaps 90°, and the rim tears into a triangular fan.
 * Inflating the radius to the band width pushes that medial kink to d = band, where the rim
 * profile is already zero. Identical to shapeSd when band <= radius, and for baked masks.
 */
float bendSd(vec2 p, float rEff) {
  if (uUseShape > 0.5) return maskShapeSd(p);
  return sdRoundRectR(p, 0.5 * uSize, rEff);
}

vec3 sampleBg(vec2 px) {
  if (uIsFullBg > 0.5) {
    vec2 localUv = vec2(px.x / uSize.x, 1.0 - px.y / uSize.y);
    vec2 uv = uBgRect.xy + localUv * uBgRect.zw;
    return texture(uBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
  }
  vec2 uv = px / uSize;
  return texture(uBg, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
}

vec3 sampleBgBlur(vec2 px, float radius) {
  if (radius < 0.35) return sampleBg(px);
  vec3 a = sampleBg(px) * 2.0;
  a += sampleBg(px + vec2(1.0, 0.0) * radius);
  a += sampleBg(px + vec2(-1.0, 0.0) * radius);
  a += sampleBg(px + vec2(0.0, 1.0) * radius);
  a += sampleBg(px + vec2(0.0, -1.0) * radius);
  float o = radius * 0.71;
  a += sampleBg(px + vec2(0.707, 0.707) * o);
  a += sampleBg(px + vec2(-0.707, 0.707) * o);
  a += sampleBg(px + vec2(0.707, -0.707) * o);
  a += sampleBg(px + vec2(-0.707, -0.707) * o);
  float o2 = radius * 1.35;
  a += sampleBg(px + vec2(1.0, 0.0) * o2);
  a += sampleBg(px + vec2(-1.0, 0.0) * o2);
  a += sampleBg(px + vec2(0.0, 1.0) * o2);
  a += sampleBg(px + vec2(0.0, -1.0) * o2);
  float o3 = radius * 1.1;
  a += sampleBg(px + vec2(0.707, 0.707) * o3);
  a += sampleBg(px + vec2(-0.707, 0.707) * o3);
  a += sampleBg(px + vec2(0.707, -0.707) * o3);
  a += sampleBg(px + vec2(-0.707, -0.707) * o3);
  return a * (1.0 / 18.0);
}

vec2 lensPx() {
  if (uLayerPass < 0.5) {
    return vec2(gl_FragCoord.x, uSize.y * uSS - gl_FragCoord.y) / uSS;
  }
  vec2 dev = vec2(gl_FragCoord.x, uLayerDevSize.y - gl_FragCoord.y);
  return dev / max(uDevScale, 1e-4) - uPageOrigin;
}

void main() {
  vec2 px = lensPx();
  float sd = shapeSd(px);
  float d = -sd;
  // No exterior softstep bleed — wide AA (-3.5) darkened neighbors (black seam beside solids).
  float alpha = d >= 0.0 ? 1.0 : smoothstep(-1.0, 0.0, d);
  if (alpha < 0.004) {
    outColor = vec4(0.0);
    return;
  }

  // A bevel wider than the half-thickness has no room left: its medial axis is the centre line
  // and no radius inflation can move it. Cap before that kink.
  float halfMin = 0.5 * min(uSize.x, uSize.y);
  float band = min(uBand, max(halfMin * 0.88, 1.0));
  float strength = min(uStrength, band * 1.25);
  float rEff = max(max(max(uRadii.x, uRadii.y), max(uRadii.z, uRadii.w)), band);
  // Bevel depth (== d away from corners); drives both the bend direction and the rim profile,
  // so the corner keeps a continuous strain rate as well as a continuous normal.
  float dB = -bendSd(px, rEff);

  float gs = uUseShape > 0.5
    // 8-bit SDF masks need a wide stencil or medial gradients die to quantization noise.
    ? clamp(band * 0.35, 1.2, 0.4 * min(uSize.x, uSize.y))
    // Analytic roundrect: the bend field is smooth across the band, so keep the stencil tight.
    : clamp(min(band * 0.12, 3.5), 1.0, 0.2 * min(uSize.x, uSize.y));
  vec2 e = vec2(gs, 0.0);
  vec2 gv = vec2(
    bendSd(px + e.xy, rEff) - bendSd(px - e.xy, rEff),
    bendSd(px + e.yx, rEff) - bendSd(px - e.yx, rEff));
  float gN = length(gv) / max(2.0 * gs, 1e-4);
  // Gate bend + chroma together — chroma-without-bend reads as RGB wedges.
  float gAlive = smoothstep(0.04, 0.28, gN);
  vec2 grad = gv / max(length(gv), 1e-4) * gAlive;

  float edgeU = clamp(1.0 - dB / max(band, 1.0), 0.0, 1.0);
  float rimF = pow(edgeU, uProfile);
  float fRim = rimF * strength * gAlive;
  // Body magnify for roundrects too (was SVG-only). Large flush panels sit past band
  // in the medial zone — without this, only a thin outer rim bends.
  float bodyU = (1.0 - rimF) * smoothstep(0.0, 0.45, clamp(dB / max(band, 1.0), 0.0, 1.0));
  vec2 fromC = px - 0.5 * uSize;
  float midR = max(length(0.5 * uSize), 1.0);
  // ponytail: rim-only for analytic roundrects — radial body magnify corners sample wrong + band short bars.
  float bodyScale = uUseShape > 0.5 ? 1.15 : 0.0;
  vec2 bodyOff = fromC * (bodyU * strength * bodyScale / midR);
  float f = fRim + length(bodyOff);
  float blurR = uFrost * (0.55 + 0.45 * (1.0 - edgeU * 0.35)) + edgeU * edgeU * uEdgeBlur;

  vec2 base = px - grad * fRim - bodyOff;
  vec2 chromaDir = length(grad) > 0.05 ? grad : normalize(bodyOff + vec2(1e-4, 0.0));
  float chroma = uChroma * gAlive;
  vec3 col = vec3(
    sampleBgBlur(base - chromaDir * (f * chroma), blurR).r,
    sampleBgBlur(base, blurR).g,
    sampleBgBlur(base + chromaDir * (f * chroma), blurR).b);

  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturate) * uBrightness;
  float frostAmt = clamp(uFrost / 28.0, 0.0, 1.0) * (1.0 - edgeU * 0.5);
  col = mix(col, vec3(luma), frostAmt * 0.28);
  col = mix(col, vec3(0.92, 0.95, 1.0), frostAmt * 0.12);
  col = mix(col, uFilm.rgb, uFilm.a);

  float rim = exp(-d * d / max(band * 0.5 + uEdgeBlur * 0.25, 1.0)) * (0.22 - 0.08 * clamp(uEdgeBlur / 64.0, 0.0, 1.0));
  col += vec3(1.0) * max(rim, 0.0);

  outColor = vec4(col * alpha, alpha);
}
