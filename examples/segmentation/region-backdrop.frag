// Background region: crushed, desaturated footage. Not decoration — if the masks fail to bind,
// the whole frame goes flat grey and the failure is unmissable instead of looking like plain footage.
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec3 src = texture(uTex0, fragCoord / iResolution.xy).rgb;
  float l = dot(src, vec3(0.2126, 0.7152, 0.0722));
  fragColor = vec4(vec3(l * 0.22 + 0.02), 1.0);
}
