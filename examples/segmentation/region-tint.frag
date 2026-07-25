// Background region: a real TREATMENT, not a passthrough — crushed luma pushed to cold blue.
// This is the case kinoBackground exists for. Refracting uTex0 under a background like this shows
// the ORIGINAL saturated plate through the glass — a hole punched to a different image. Refracting
// THIS matches what is actually behind the subject.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 src = texture(uTex0, fragCoord / iResolution.xy).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(vec3(l) * vec3(0.35, 0.55, 0.90), 1.0);
}
