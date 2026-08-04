// Runs the post chain over the finished composite. Every stage is an ordinary EffectPass, so
// this is a thin resolver plus a runChain call — the interesting part is the fixed ordering
// and the theme.film default.
import type { Theme } from "../../../props.js";
import type { EffectRef } from "./graph.js";
import { postChainOrder, type PostFx } from "../../../postSpec.js";
import { getPass, runChain } from "./effects/chain.js";
import type { EffectPass } from "./effects/pass.js";
import { TargetPool, type RenderTarget } from "./targets.js";

export interface ResolvedPass {
  pass: EffectPass;
  params: Record<string, number | string | WebGLTexture>;
}

/**
 * Reduce `src` to a single texel holding the frame's mean colour, by repeated 2:1 blits.
 *
 * This is what makes `veil` content-responsive, and it is a blit pyramid rather than one big
 * downscale because a single blit is a BILINEAR sample, not a box average — mapping 1920 rows onto
 * 64 would read four texels out of every nine hundred and miss exactly the small bright element
 * the stage exists to react to. Halving is the case where bilinear IS the box average (the
 * destination texel centre lands on the corner of four sources, weights 0.25 each), so a chain of
 * halvings averages every pixel exactly once. ~11 steps for a 1080-class frame, and only the first
 * reads a full frame — together about 1.3 passes' worth of fill.
 *
 * The averaging happens in whatever space the driver's sRGB blit conversion lands in, which is not
 * worth pinning down: the driver only has to RESPOND to scene brightness monotonically, and both
 * candidate spaces do. Caller releases the returned target.
 */
function reduceToMean(gl: WebGL2RenderingContext, pool: TargetPool, src: RenderTarget): RenderTarget {
  let cur = src;
  let owned: RenderTarget | null = null;
  while (cur.w > 1 || cur.h > 1) {
    const w = Math.max(1, cur.w >> 1);
    const h = Math.max(1, cur.h >> 1);
    const dst = pool.acquire(gl, w, h);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cur.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
    gl.blitFramebuffer(0, 0, cur.w, cur.h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    // Released only AFTER the next size is acquired, so the pool can never hand the same target
    // back as this step's destination.
    if (owned) pool.release(owned);
    owned = dst;
    cur = dst;
  }
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  // A 1x1 source needs no reduction and must still hand back something the caller can release
  // without freeing the composite — copy it.
  return owned ?? copyTarget(gl, pool, src);
}

function copyTarget(gl: WebGL2RenderingContext, pool: TargetPool, src: RenderTarget): RenderTarget {
  const dst = pool.acquire(gl, src.w, src.h);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src.fbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, dst.fbo);
  gl.blitFramebuffer(0, 0, src.w, src.h, 0, 0, dst.w, dst.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  return dst;
}

/**
 * Which passes run, in which order, with which params. A stage that is absent does not run —
 * except `film`, which falls back to theme.film so existing specs keep their finish.
 */
/**
 * Resolve a layer's authored `adjust` chain to passes. Same shape as the post chain, but the
 * params come off the layer instead of spec.postFx — an adjustment layer states what it does.
 *
 * `film` is the one stage that still reaches for a theme value: its vignette is tinted by the
 * night colour, and no layer should have to restate the theme to get its own default look.
 * `ss` is the stage supersample factor, which every pass needs to keep its pixel radii honest.
 */
export function resolveAdjustChain(adjust: EffectRef[], theme: Theme, ss = 1): ResolvedPass[] {
  const out: ResolvedPass[] = [];
  for (const a of adjust) {
    const pass = getPass(a.kind);
    if (!pass) continue;
    const params: Record<string, number | string> = { ...a.params, ss };
    if (a.kind === "film") params.night = theme.bg;
    out.push({ pass, params });
  }
  return out;
}

/**
 * Grade / bloom / lens — run over the finished composite. `film` is excluded: it is an
 * adjustment LAYER now (layersAt §12), so it runs mid-stack where its z puts it, not here.
 *
 * `ss` is the stage supersample factor. The tail chain runs AFTER the resolve to output
 * resolution (StageRenderer.draw), but bloom's `radius` is in target pixels — it used to be
 * applied to the SS-sized composite, so its visible radius has always been `radius / ss`.
 * Dividing here keeps existing specs pixel-comparable across the move.
 *
 * That also means `radius` currently means different things at SS=1 (draft) and SS=2 (final) —
 * a draft preview shows a 2× wider bloom than the final. Making `radius` mean output pixels is a
 * deliberate visual change; it is this one division, deleted.
 */
export function resolveTailPostChain(post: PostFx | undefined, theme: Theme, ss = 1): ResolvedPass[] {
  const chain = resolvePostChain(post, theme).filter((p) => p.pass.name !== "film");
  if (ss === 1) return chain;
  return chain.map((p) =>
    p.pass.name === "bloom" ? { ...p, params: { ...p.params, radius: Number(p.params.radius ?? 24) / ss } } : p,
  );
}

export function resolvePostChain(post: PostFx | undefined, theme: Theme): ResolvedPass[] {
  const out: ResolvedPass[] = [];
  for (const stage of postChainOrder) {
    const params = post?.[stage] as Record<string, number> | undefined;
    if (stage === "film") {
      const intensity = params?.intensity ?? theme.film ?? 1;
      if (intensity > 0) {
        const pass = getPass("film");
        if (pass) out.push({ pass, params: { intensity, night: theme.bg } });
      }
      continue;
    }
    if (stage === "bloom" && params) {
      const pass = getPass("bloom");
      if (pass) {
        out.push({ pass, params: { ...params, axis: "x" } });
        out.push({ pass, params: { ...params, axis: "y" } });
        const composite = getPass("bloomComposite");
        if (composite) out.push({ pass: composite, params: { ...params, axis: "composite" } });
      }
      continue;
    }
    if (!params) continue;
    const pass = getPass(stage);
    if (pass) out.push({ pass, params });
  }
  return out;
}

/** The blur passes and the add-back are separate programs but one logical stage — they must stay
 *  in the same slice so the add-back still sees the pre-bloom copy. */
const isBloom = (name: string) => name === "bloom" || name === "bloomComposite";

/** `veil` needs a measurement of everything composited so far, which only this level can take —
 *  a pass sees one texel at a time. */
const isVeil = (name: string) => name === "veil";

/** Run the resolved post chain over the composite. Caller owns `composite` when the chain is empty. */
export function runPost(
  gl: WebGL2RenderingContext,
  pool: TargetPool,
  composite: RenderTarget,
  chain: ResolvedPass[],
  frame: number,
): RenderTarget {
  if (!chain.length) return composite;
  let read = composite;
  let owned: RenderTarget | null = null;
  let i = 0;
  while (i < chain.length) {
    if (isBloom(chain[i].pass.name)) {
      const bloomOriginal = copyTarget(gl, pool, read);
      const bloomSlice: ResolvedPass[] = [];
      while (i < chain.length && isBloom(chain[i].pass.name)) {
        const e = chain[i++];
        const params = { ...e.params };
        if (params.axis === "composite") params._originalTex = bloomOriginal.tex;
        bloomSlice.push({ pass: e.pass, params });
      }
      const out = runChain(gl, pool, read, bloomSlice as Array<{ pass: EffectPass; params: Record<string, number | string> }>, frame);
      pool.release(bloomOriginal);
      if (owned) pool.release(owned);
      owned = out === read ? null : out;
      read = out;
    } else if (isVeil(chain[i].pass.name)) {
      // Measured from `read` — everything composited BENEATH this stage, which is the light that
      // would have entered the lens. Its own slice for the same reason bloom has one: the pass
      // cannot take the measurement itself, so the level that owns the targets takes it first.
      const e = chain[i++];
      const mean = reduceToMean(gl, pool, read);
      const veilSlice: ResolvedPass[] = [{ pass: e.pass, params: { ...e.params, _driveTex: mean.tex } }];
      const out = runChain(
        gl,
        pool,
        read,
        veilSlice as Array<{ pass: EffectPass; params: Record<string, number | string> }>,
        frame,
      );
      pool.release(mean);
      if (owned) pool.release(owned);
      owned = out === read ? null : out;
      read = out;
    } else {
      const slice: ResolvedPass[] = [];
      while (i < chain.length && !isBloom(chain[i].pass.name) && !isVeil(chain[i].pass.name)) slice.push(chain[i++]);
      const out = runChain(gl, pool, read, slice as Array<{ pass: EffectPass; params: Record<string, number | string> }>, frame);
      if (owned) pool.release(owned);
      owned = out === read ? null : out;
      read = out;
    }
  }
  return read;
}

/**
 * Test hook: the FULL post chain over a real pooled target, not a single pass.
 *
 * This exists because `probeEffect` runs one pass with the default `axis`, so every bloom test
 * ever written exercised the blur and never the add-back — which is how a dead `postFx.bloom`
 * survived. Here the chain is resolved exactly as a render resolves it (bright-pass → blur x →
 * blur y → composite), over a pool target with a real fbo, so the composite step and its
 * `uOriginal` binding are actually covered.
 *
 * Fixture: black frame, one white disc at the centre. Returns the red channel sampled outward
 * from the disc edge, so a working bloom shows light where the source is black.
 *
 * NOTE ON WHAT THIS CANNOT CATCH: the glProbe host runs a plain webgl2 context, while a render
 * forces ANGLE/Metal. The miscompile that made the add-back a no-op reproduced only on the latter
 * — this probe passed against the broken shader. It covers the chain's LOGIC (ordering, target
 * lifetimes, the uOriginal binding); the pixel guarantee belongs to the real-render assertion in
 * tests/postfx-integration.test.ts.
 */
/**
 * Test hook: the tail chain over a black frame carrying one centred disc of a given size, reading
 * a corner the disc never touches plus the disc itself.
 *
 * Separate from probePostChain because the thing under test is different in kind. That probe asks
 * "does light appear where the source was black" with a fixed fixture; this one asks whether the
 * SAME parameters produce a different result on a dimmer frame, which needs the fixture's light
 * level to be the variable. It also runs against the real TargetPool for a reason: `reduceToMean`
 * acquires a pyramid of sizes and releases each step as it goes, and a pool with no free list
 * would not exercise the aliasing that ordering exists to prevent.
 *
 * Returns [cornerR, cornerG, cornerB, discR] in 0..255.
 */
export function probeVeil(
  canvas: HTMLCanvasElement,
  postFx: PostFx,
  discFrac: number,
  discColour = "#ffffff",
): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const w = canvas.width;
  const h = canvas.height;

  const c2d = document.createElement("canvas");
  c2d.width = w;
  c2d.height = h;
  const ctx = c2d.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  if (discFrac > 0) {
    ctx.fillStyle = discColour;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, (w / 2) * discFrac, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

  // The composite must be a pooled target with a real fbo: reduceToMean blits FROM it.
  const composite = pool.acquire(gl, w, h);
  const blitSrc = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, blitSrc);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, blitSrc);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, composite.fbo);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  const theme = { bg: "#000000" } as unknown as Theme;
  const out = runPost(gl, pool, composite, resolveTailPostChain(postFx, theme, 1), 0);

  const at = (x: number, y: number): Uint8Array => {
    const px = new Uint8Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };
  const corner = at(2, 2);
  return [corner[0], corner[1], corner[2], at(Math.floor(w / 2), Math.floor(h / 2))[0]];
}

export function probePostChain(canvas: HTMLCanvasElement, postFx: PostFx, offsets: number[], churn = 0): number[] {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })!;
  const pool = new TargetPool();
  const w = canvas.width;
  const h = canvas.height;

  const c2d = document.createElement("canvas");
  c2d.width = w;
  c2d.height = h;
  const ctx = c2d.getContext("2d")!;
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.max(2, w / 16), 0, Math.PI * 2);
  ctx.fill();

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c2d);

  // A REAL pooled target, blitted from the fixture — the composite path needs a source with an
  // fbo, and pooling it is what puts the pool in the state a render leaves it in.
  // Simulate what a layer walk leaves behind: targets acquired and handed back, so the free
  // list is populated and `composite` itself comes out of it rather than being freshly made.
  if (churn > 0) {
    const scratch: RenderTarget[] = [];
    for (let i = 0; i < churn; i++) scratch.push(pool.acquire(gl, w, h));
    for (const t of scratch) pool.release(t);
  }
  const composite = pool.acquire(gl, w, h);
  const blitSrc = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, blitSrc);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, blitSrc);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, composite.fbo);
  gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

  const theme = { bg: "#000000" } as unknown as Theme;
  const out = runPost(gl, pool, composite, resolveTailPostChain(postFx, theme, 1), 0);

  const px = new Uint8Array(4);
  return offsets.map((d) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.readPixels(Math.round(w / 2 + d), Math.round(h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[0];
  });
}
