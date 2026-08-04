/**
 * Pixel transport for the `readback` capture path, as source injected into the render page.
 *
 * Why this exists: `readback` is the only route to a hardware encoder on Linux (WebGL → IPC →
 * CUDA/NVENC), because Chromium there cannot reach NVENC itself — see the `prefer-hardware`
 * comment in `page/captureH264.ts`, which is why the `direct` path falls back to software
 * OpenH264. So the cost of getting pixels out of WebGL is what decides whether the hardware
 * encoder is worth using at all.
 *
 * The original transport was `readPixels` straight into a fresh `Uint8Array`, and it was slow for
 * a reason that is NOT the GPU. Measured on an M4 (1080×1920, shader spec) with a `gl.finish()`
 * inserted first, the GPU was already idle — `finish()` returned in 0.06ms — and the read still
 * cost 34.6ms. The time goes on Chromium's *synchronous command-buffer round trip* to the GPU
 * process, which blocks the renderer for the whole 8.3MB.
 *
 * `pboRead` issues the same read into a PIXEL_PACK_BUFFER instead. That half is genuinely async
 * (0.01ms), so only the `getBufferSubData` fetch still blocks:
 *
 *   | transport                        | read leg | glass-morph |
 *   |----------------------------------|----------|-------------|
 *   | sync readPixels (was)            | 34.6 ms  |  86.1 fps   |
 *   | PBO, same-frame fetch (is)       | 23.5 ms  |  99.6 fps   |
 *   | PBO, fetch frame N-1 (not taken) | 14.1 ms  |     —       |
 *
 * The pipelined row is faster still, but returning frame N-1's pixels adds a second frame of
 * pipeline lag, and `engine.ts`'s `storeLag` contract assumes exactly one for every capture kind
 * (see the parking deadlock documented at its `run === 0` branch). Same-frame keeps that contract
 * untouched, which is why it is what ships.
 *
 * The buffer and destination array are reused across frames. That is safe because `pushFrame`
 * structured-clones them into the IPC message before this returns — verified on real output, not
 * just reasoned about: a torn or shifted frame would show up as a temporal offset, and aligned
 * PSNR (70.2 dB) beats the one-frame-offset comparison (32.3 dB) by ~38 dB.
 */
export const READBACK_HELPERS_JS = `
  function syncRead(gl, w, h) {
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }
  function pboRead(gl, w, h) {
    const g = (window.__kinoRb ||= {});
    const size = w * h * 4;
    // Rebuild on either a size change (the old buffer is the wrong length for getBufferSubData and
    // every later frame would throw) or a different GL context. The context check is not
    // hypothetical: a lost-and-restored context at the same canvas size would otherwise keep a
    // handle belonging to a dead context, which fails in a far more confusing way than a resize.
    if (g.size !== size || g.gl !== gl) {
      if (g.pbo && g.gl === gl) gl.deleteBuffer(g.pbo);
      g.gl = gl;
      g.pbo = gl.createBuffer();
      g.size = size;
      g.dst = new Uint8Array(size);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, size, gl.STREAM_READ);
    } else {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, g.pbo);
    }
    // Offset form (not an ArrayBufferView): this is the variant that lands in the PBO instead of
    // blocking on a copy back to JS.
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, g.dst);
    // Leaving PIXEL_PACK_BUFFER bound would silently redirect any later readPixels in the page
    // (e.g. the compositor's probe reads) into this buffer.
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    return g.dst;
  }
`;

/** KINO_RB_SYNC=1 restores the pre-PBO synchronous readPixels, so the two transports can be A/B'd
 *  on a box — notably a Linux/NVENC one — without a rebuild. */
export function syncReadbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.KINO_RB_SYNC === "1";
}
