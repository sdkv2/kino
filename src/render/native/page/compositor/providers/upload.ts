// One texture upload path for every provider — so premultiply, filtering and wrap are set
// identically everywhere. Getting any of these wrong per-provider is how edge artifacts and
// alpha mismatches creep in.
//
// Alpha is STRAIGHT here, not premultiplied, and that is load-bearing. The compositor blends in
// linear light, and UNPACK_PREMULTIPLY_ALPHA_WEBGL would multiply in sRGB space — but
// decode(c*a) != decode(c)*a, so premultiplying before the decode darkens every soft edge. The
// premultiply happens in renderer.ts's FRAG instead, after GL has decoded the colour.
/**
 * `mipmap` is for textures that get MINIFIED — a source larger than the box it lands in. Without
 * a mip chain that is one bilinear tap across a shrinking footprint, which shimmers under motion
 * and is the usual reason a renderer reaches for supersampling to paper over it.
 *
 * NOT safe for atlases/sprite sheets sampled by sub-rect: mip levels average across cell borders,
 * so a sheet bleeds neighbouring frames as it minifies. Per-frame plates don't want it either —
 * they upload 1:1 at output size, so the chain is pure cost. Opt in deliberately.
 */
/**
 * `srgb: false` opts a texture OUT of the linear zone.
 *
 * The compositor blends in linear light, so its textures are SRGB8_ALPHA8 with straight alpha and
 * the quad shader premultiplies after GL's decode. But this helper is also used by GL that lives
 * outside that zone — the underlay plate and gpuBlit both feed the lens/motion pipeline, whose
 * shaders treat their samples as sRGB and write plain RGBA8 targets. Handing those an sRGB-format
 * texture means the hardware decodes to linear and nothing re-encodes, which crushes the blacks
 * and oversaturates the whole plate. Those callers pass `srgb: false` and get raw bytes.
 */
export function uploadCanvasOrImage(
  gl: WebGL2RenderingContext,
  existing: WebGLTexture | null,
  src: CanvasImageSource,
  opts: { mipmap?: boolean; srgb?: boolean } = {},
): WebGLTexture {
  const srgb = opts.srgb !== false;
  const tex = existing ?? gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !srgb);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    opts.mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, srgb ? gl.SRGB8_ALPHA8 : gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
  if (opts.mipmap) {
    // WebGL2 allows NPOT mip chains, so no power-of-two padding is needed.
    gl.generateMipmap(gl.TEXTURE_2D);
    const agg = gl.getExtension("EXT_texture_filter_anisotropic");
    if (agg) {
      const max = gl.getParameter(agg.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      gl.texParameterf(gl.TEXTURE_2D, agg.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(4, max));
    }
  }
  return tex;
}

/** Load an <img> to completion. Rejects nothing — a broken asset yields null, matching the
 *  DOM path where a failed <img> is a blank layer rather than a crash. */
export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
