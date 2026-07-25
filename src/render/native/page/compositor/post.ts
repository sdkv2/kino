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
  params: Record<string, number | string>;
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
  return runChain(gl, pool, composite, chain, frame);
}
