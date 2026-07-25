// Offscreen render targets. A layer that carries a mask or an effect chain cannot draw
// straight to the frame — it renders here first, gets operated on, then composites.
//
// Pooled by size: a 1080x1920 RGBA target is ~8MB, and allocating one per layer per frame
// would thrash the driver. Targets are handed out for the duration of one layer's draw and
// returned immediately after.
export interface RenderTarget {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

const key = (w: number, h: number) => `${w}x${h}`;

export class TargetPool {
  private free = new Map<string, RenderTarget[]>();
  private all: RenderTarget[] = [];

  acquire(gl: WebGL2RenderingContext, w: number, h: number): RenderTarget {
    const bucket = this.free.get(key(w, h));
    const reused = bucket?.pop();
    if (reused) return reused;

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`compositor: render target incomplete (0x${status.toString(16)}) at ${w}x${h}`);
    }

    const target: RenderTarget = { fbo, tex, w, h };
    this.all.push(target);
    return target;
  }

  release(target: RenderTarget): void {
    const k = key(target.w, target.h);
    const bucket = this.free.get(k) ?? [];
    bucket.push(target);
    this.free.set(k, bucket);
  }

  /** Clear a target to fully transparent. Callers rely on this: a reused target still holds
   *  the previous layer's pixels. */
  clear(gl: WebGL2RenderingContext, target: RenderTarget): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const t of this.all) {
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    this.all = [];
    this.free.clear();
  }
}
