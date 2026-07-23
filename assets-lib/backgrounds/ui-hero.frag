// ui-hero — a DOM texture (uTex0, spec backgroundTextures) as the hero object of a 3D scene:
// the rasterized UI card floats in perspective with a soft cloth sway, materializes out of
// ember shards (drive the `reveal` param 0→1 with backgroundKeyframes → uParam0), and lands on
// a glossy floor reflection. Atmosphere: brand-lit gradient, back-glow, drifting dust.
// Deterministic: camera, sway, shards and dust all ride iTime; reveal rides the spec keyframes.
//
//   params (alphabetical → uParam slots):
//     fill   0..1  (uParam0) — scrubs the card's own CSS animation (live per-frame raster)
//     reveal 0..1  (uParam1) — 0 = fully dissolved, 1 = intact card
//   texture: backgroundTextures[0] — the UI card ({ source, param: "fill" } live-scrub mode)

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

// Panel local frame: center, half-size (world units), sway angle. Aspect from the texture.
const float PANEL_W = 0.78;
vec2 panelHalf() {
  float aspect = uTexSize0.x > 1.0 ? uTexSize0.y / uTexSize0.x : 0.34;
  return 0.5 * vec2(PANEL_W, PANEL_W * aspect);
}

// Sample the card with dissolve shards + cloth ripple. uv in panel space [0,1]. Straight alpha.
vec4 card(vec2 uv, float reveal) {
  if (uTexSize0.x < 1.0) return vec4(0.0);

  // Cloth ripple — subtle traveling wave, stronger while the card is still materializing.
  float wob = 0.0035 + 0.012 * (1.0 - reveal);
  uv.x += sin(uv.y * 9.0 + iTime * 1.7) * wob;
  uv.y += sin(uv.x * 7.0 - iTime * 1.3) * wob * 0.6;

  // Shard grid: each cell gets a threshold; cells above the reveal front lift away and fade.
  vec2 cell = floor(uv * vec2(26.0, 10.0));
  float n = hash21(cell);
  float front = reveal * 1.25 - 0.12;      // sweeps -0.12 → 1.13 so ends are fully off/on
  float over = n - front;                  // <0 = settled, >0 = not yet arrived
  if (over > 0.28) return vec4(0.0);       // long gone

  vec2 drift = vec2(hash21(cell + 7.0) - 0.3, 0.6 + hash21(cell + 13.0)) * over * 0.55;
  vec2 suv = uv + (over > 0.0 ? drift : vec2(0.0));
  if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return vec4(0.0);
  vec4 tex = texture(uTex0, suv); // live-scrub channel: pixels already match this frame's `fill`

  if (over > 0.0) {
    // Flying shard: fade out + burn toward the brand ember color.
    float fade = 1.0 - smoothstep(0.0, 0.28, over);
    vec3 ember = mix(tex.rgb, uColorC * 1.6, clamp(over * 6.0, 0.0, 1.0));
    return vec4(ember, tex.a * fade * 0.9);
  }
  // Settled: brief hot edge right behind the front.
  float glow = smoothstep(0.06, 0.0, -over) * 0.8;
  return vec4(tex.rgb + uColorC * glow, tex.a);
}

// Intersect a ray with the swaying panel plane; return uv + alpha-composited color.
// Panel center sits above the floor; sway = slow yaw + tiny pitch breathing.
vec4 panelHit(vec3 ro, vec3 rd, float reveal, out float tHit) {
  vec3 c = vec3(0.0, 0.19, 0.0);
  float yaw = sin(iTime * 0.5) * 0.16;
  float pitch = sin(iTime * 0.33) * 0.05;
  vec3 n = vec3(sin(yaw), sin(pitch), cos(yaw) * cos(pitch));
  vec3 tanX = normalize(cross(vec3(0.0, 1.0, 0.0), n));
  vec3 tanY = normalize(cross(n, tanX));

  tHit = 1e5;
  float denom = dot(rd, n);
  if (abs(denom) < 1e-4) return vec4(0.0);
  float t = dot(c - ro, n) / denom;
  if (t < 0.0) return vec4(0.0);
  vec3 p = ro + rd * t;
  vec2 half_ = panelHalf();
  vec2 local = vec2(dot(p - c, tanX), dot(p - c, tanY));
  if (abs(local.x) > half_.x || abs(local.y) > half_.y) return vec4(0.0);
  tHit = t;
  vec2 uv = local / (2.0 * half_) + 0.5;
  vec4 col = card(uv, reveal);
  // Grazing sheen: the card catches a highlight as it sways (sells the 3D plane).
  float sheen = pow(1.0 - abs(dot(rd, n)), 3.0) * 0.35;
  col.rgb += vec3(sheen) * col.a;
  return col;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * iResolution.xy) / iResolution.y;
  float reveal = clamp(uParam1, 0.0, 1.0);

  // Gentle orbit camera looking at the card.
  vec3 ro = vec3(sin(iTime * 0.18) * 0.35, 0.34, 2.6);
  vec3 target = vec3(0.0, 0.24, 0.0);
  vec3 fwd = normalize(target - ro);
  vec3 rgt = normalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
  vec3 upv = cross(rgt, fwd);
  vec3 rd = normalize(fwd * 1.9 + rgt * uv.x + upv * (uv.y - 0.10));

  // Brand-lit backdrop: vertical wash + soft glow behind the card.
  float bgf = clamp(uv.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uColorB * 0.10, uColorA * 0.05, bgf);
  col += uColorA * 0.10 * exp(-dot(uv - vec2(0.0, 0.16), uv - vec2(0.0, 0.16)) * 5.5);

  // Drifting dust motes (screen-space, deterministic).
  vec2 dp = fragCoord / iResolution.y * 3.0 + vec2(iTime * 0.02, iTime * 0.013);
  vec2 dc = floor(dp * 14.0);
  float dh = hash21(dc);
  vec2 dl = fract(dp * 14.0) - 0.5;
  float mote = smoothstep(0.06, 0.0, length(dl - (vec2(dh, hash21(dc + 3.0)) - 0.5) * 0.6));
  col += vec3(mote) * 0.05 * smoothstep(0.75, 1.0, dh);

  // Floor: glossy dark plane. Reflection = mirrored ray re-intersected with the panel,
  // faded + wobbled with distance (cheap roughness).
  float floorY = 0.0;
  float tPanel;
  vec4 pc = panelHit(ro, rd, reveal, tPanel);
  float tFloor = rd.y < -1e-4 ? (floorY - ro.y) / rd.y : 1e6;

  if (tFloor < tPanel) {
    vec3 fp = ro + rd * tFloor;
    vec3 rrd = reflect(rd, vec3(0.0, 1.0, 0.0));
    // roughness wobble grows with reflected distance
    rrd.xz += (hash21(fp.xz * 37.0) - 0.5) * 0.015;
    float tR;
    vec4 rc = panelHit(fp + rrd * 1e-3, normalize(rrd), reveal, tR);
    float dist = length(fp.xz - ro.xz);
    vec3 floorCol = mix(uColorB, uColorA, 0.3) * 0.09 * exp(-dist * 0.45);
    float rfade = 0.55 * exp(-tR * 0.22);
    // Fog the floor back into the atmosphere with distance so the horizon dissolves instead of
    // cutting a hard line across the frame (the plane is infinite; the seam was the giveaway).
    float fog = exp(-max(tFloor - 1.4, 0.0) * 0.45);
    col = mix(col, floorCol + rc.rgb * rc.a * rfade, fog);
  }
  // Grade the SCENE only (caption-safe lower third + vignette + pulse flash)…
  col *= mix(0.62, 1.0, smoothstep(-0.85, -0.2, uv.y));
  float vig = smoothstep(1.45, 0.3, length(uv));
  col *= 0.6 + 0.5 * vig;
  col += uColorC * (0.14 * uPulse);

  // …then composite the card ON TOP, ungraded: the UI reads at full DOM brightness, as if the
  // element were rendered straight to the page. Reflection + shards stay cinematic (scene layer).
  if (pc.a > 0.001) {
    col = mix(col, pc.rgb, pc.a);
  }

  fragColor = vec4(col, 1.0);
}
