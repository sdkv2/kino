// Runs the post chain over the finished composite. Every stage is an ordinary EffectPass, so
// this is a thin resolver plus a runChain call — the interesting part is the fixed ordering
// and the theme.film default.
import type { Theme } from "../../../props.js";
import type { EffectRef } from "./graph.js";
import { postChainOrder, type PostFx } from "../../../postSpec.js";
import { getPass, runChain } from "./effects/chain.js";
import type { EffectPass } from "./effects/pass.js";
import type { TargetPool, RenderTarget } from "./targets.js";

export interface ResolvedPass {
  pass: EffectPass;
  params: Record<string, number | string | WebGLTexture>;
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
    if (a.kind === "film") params.night = theme.night;
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
        if (pass) out.push({ pass, params: { intensity, night: theme.night } });
      }
      continue;
    }
    if (stage === "bloom" && params) {
      const pass = getPass("bloom");
      if (pass) {
        out.push({ pass, params: { ...params, axis: "x" } });
        out.push({ pass, params: { ...params, axis: "y" } });
        out.push({ pass, params: { ...params, axis: "composite" } });
      }
      continue;
    }
    if (!params) continue;
    const pass = getPass(stage);
    if (pass) out.push({ pass, params });
  }
  return out;
}

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
    if (chain[i].pass.name === "bloom") {
      const bloomOriginal = copyTarget(gl, pool, read);
      const bloomSlice: ResolvedPass[] = [];
      while (i < chain.length && chain[i].pass.name === "bloom") {
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
    } else {
      const slice: ResolvedPass[] = [];
      while (i < chain.length && chain[i].pass.name !== "bloom") slice.push(chain[i++]);
      const out = runChain(gl, pool, read, slice as Array<{ pass: EffectPass; params: Record<string, number | string> }>, frame);
      if (owned) pool.release(owned);
      owned = out === read ? null : out;
      read = out;
    }
  }
  return read;
}
