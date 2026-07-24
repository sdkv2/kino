// Per-object region body for mask entry 1. Warm posterised footage + a DOUBLE amber rim,
// deliberately unlike entry 0 so a swapped identity is obvious on sight.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  vec3 src = texture(uTex0, uv).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  l = floor(l * 6.0) / 6.0; // posterise — visibly different material from entry 0's smooth ramp

  vec3 body = mix(vec3(0.20, 0.05, 0.02), vec3(1.00, 0.86, 0.55), l);

  float d = kinoMaskDist(uMaskSelf, uChannelSelf, fragCoord, 14.0);
  // two concentric bands
  float r1 = 1.0 - smoothstep(1.0, 2.5, abs(d + 2.0));
  float r2 = 1.0 - smoothstep(1.0, 2.5, abs(d + 8.0));
  float rim = max(r1, r2);

  fragColor = vec4(mix(body, vec3(1.0, 0.62, 0.10), rim), 1.0);
}
