// Runs the post chain over the finished composite. Every stage is an ordinary EffectPass, so
// this is a thin resolver plus a runChain call — the interesting part is the fixed ordering
// and the theme.film default.
import type { Theme } from "../../../props.js";
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
