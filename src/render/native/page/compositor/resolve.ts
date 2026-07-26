// Full-frame FXAA resolve: supersampled composite → display-sized canvas.
//
// Straight copy in GL space, NO y-flip: both the source RenderTarget and the default
// framebuffer put the visual top at the high GL row, and toDataURL already reads the drawing
// buffer top-down. Flipping here mirrors the WHOLE frame at SS>1 — if layers look inverted,
// the bug is a uFlipY mismatch in renderer.ts, not here.
const FXAA_VERT = `#version 300 es
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FXAA_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uInvRes;
out vec4 kino_frag;
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec2 uv = gl_FragCoord.xy * uInvRes;
  vec3 m  = texture(uSrc, uv).rgb;
  vec3 nw = texture(uSrc, uv + vec2(-1.0,-1.0) * uInvRes).rgb;
  vec3 ne = texture(uSrc, uv + vec2( 1.0,-1.0) * uInvRes).rgb;
  vec3 sw = texture(uSrc, uv + vec2(-1.0, 1.0) * uInvRes).rgb;
  vec3 se = texture(uSrc, uv + vec2( 1.0, 1.0) * uInvRes).rgb;
  float lm = lum(m), lnw = lum(nw), lne = lum(ne), lsw = lum(sw), lse = lum(se);
  float lmin = min(lm, min(min(lnw, lne), min(lsw, lse)));
  float lmax = max(lm, max(max(lnw, lne), max(lsw, lse)));
  if (lmax - lmin < max(0.05, lmax * 0.10)) { kino_frag = vec4(m, 1.0); return; }
  vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), ((lnw + lsw) - (lne + lse)));
  float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
  dir = clamp(dir * rcp, -8.0, 8.0) * uInvRes;
  vec3 a = 0.5 * (texture(uSrc, uv + dir * (-1.0/6.0)).rgb + texture(uSrc, uv + dir * (1.0/6.0)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture(uSrc, uv + dir * -0.5).rgb + texture(uSrc, uv + dir * 0.5).rgb);
  float lb = lum(b);
  kino_frag = vec4((lb < lmin || lb > lmax) ? a : b, 1.0);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uOutRes;
out vec4 kino_frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uOutRes;
  kino_frag = vec4(texture(uSrc, uv).rgb, 1.0);
}`;

export class CompositeResolve {
  private fxaa: WebGLProgram | null = null;
  private copy: WebGLProgram | null = null;
  private fxaaSrc: WebGLUniformLocation | null = null;
  private fxaaInvRes: WebGLUniformLocation | null = null;
  private copySrc: WebGLUniformLocation | null = null;
  private copyOutRes: WebGLUniformLocation | null = null;

  constructor(private gl: WebGL2RenderingContext) {
    const mk = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null;
      return sh;
    };
    const link = (vs: WebGLShader, fs: WebGLShader): WebGLProgram | null => {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return prog;
    };
    const vs = mk(gl.VERTEX_SHADER, FXAA_VERT);
    if (!vs) return;
    const fsFxaa = mk(gl.FRAGMENT_SHADER, FXAA_FRAG);
    if (fsFxaa) {
      this.fxaa = link(vs, fsFxaa) ?? null;
      if (this.fxaa) {
        this.fxaaSrc = gl.getUniformLocation(this.fxaa, "uSrc");
        this.fxaaInvRes = gl.getUniformLocation(this.fxaa, "uInvRes");
      }
    }
    const fsCopy = mk(gl.FRAGMENT_SHADER, COPY_FRAG);
    if (fsCopy) {
      const vs2 = mk(gl.VERTEX_SHADER, FXAA_VERT);
      if (vs2) {
        this.copy = link(vs2, fsCopy) ?? null;
        if (this.copy) {
          this.copySrc = gl.getUniformLocation(this.copy, "uSrc");
          this.copyOutRes = gl.getUniformLocation(this.copy, "uOutRes");
        }
      }
    }
  }

  /** Downsample (+ optional FXAA) from `src` into the default framebuffer at `outW`×`outH`. */
  present(src: WebGLTexture, outW: number, outH: number, useFxaa: boolean): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, outW, outH);
    gl.disable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src);
    if (useFxaa && this.fxaa && this.fxaaSrc && this.fxaaInvRes) {
      gl.useProgram(this.fxaa);
      gl.uniform1i(this.fxaaSrc, 0);
      gl.uniform2f(this.fxaaInvRes, 1 / outW, 1 / outH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }
    if (this.copy && this.copySrc && this.copyOutRes) {
      gl.useProgram(this.copy);
      gl.uniform1i(this.copySrc, 0);
      gl.uniform2f(this.copyOutRes, outW, outH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  dispose(): void {
    if (this.fxaa) this.gl.deleteProgram(this.fxaa);
    if (this.copy) this.gl.deleteProgram(this.copy);
  }
}
