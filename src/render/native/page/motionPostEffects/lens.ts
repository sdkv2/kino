// Backdrop-sampling lenses (`kino-lens` + `data-lens` materials) after motion raster.
import { applyLensMirrors } from "../lensMirror.js";
import { peekBackdrop, peekBackdropTexture, registerBackdrop, registerMergedBackdrop } from "../backdrop.js";
import type { MotionFrameBundle, MotionLensHost } from "../lensLayout.js";
import { executeLensCompositeNode } from "../lensCompositeNode.js";
import type { MotionPostEffect, MotionPostResult } from "./types.js";
import { LENS_CLASS_RE } from "../../../lensContract.js";

export const lensPostEffect: MotionPostEffect = {
  test: (html) => LENS_CLASS_RE.test(html),
  apply({ sample, chrome, manifest, plates, lensHost, html, width, height, gl, lensShaders }): MotionPostResult {
    const shaders = lensShaders ?? {};
    if (!sample || !chrome || !manifest || !plates) return sample ?? chrome ?? document.createElement("canvas");

    const underCompositor = peekBackdrop();
    const underCompositorTex = peekBackdropTexture();

    if (gl && underCompositorTex && manifest.lenses.length > 0) {
      const gpu = executeLensCompositeNode({
        gl,
        manifest,
        plates,
        backdrop: underCompositorTex,
        lensShaders: shaders,
      });
      if (gpu) return gpu;
    }

    const host = lensHost;
    if (!host) return sample;

    const out = document.createElement("canvas");
    out.width = sample.width;
    out.height = sample.height;
    const ctx = out.getContext("2d");
    if (!ctx) return sample;

    const s = width > 0 ? sample.width / width : 1;
    const hr = host.texRoot.getBoundingClientRect();
    ctx.drawImage(sample, 0, 0);
    let stackBackdrop: HTMLCanvasElement | null = null;
    for (let n = 0; n < host.stack.length; n++) {
      if (n > 0) {
        if (!stackBackdrop) {
          stackBackdrop = document.createElement("canvas");
          stackBackdrop.width = out.width;
          stackBackdrop.height = out.height;
        }
        const sb = stackBackdrop.getContext("2d")!;
        sb.clearRect(0, 0, out.width, out.height);
        sb.drawImage(out, 0, 0);
        registerBackdrop(stackBackdrop, out.width, out.height);
      } else {
        registerMergedBackdrop(sample, underCompositor);
      }
      const el = host.stack[n]!;
      applyLensMirrors(host.texRoot, { elements: [el], lensShaders: shaders });
      const mirror = el.querySelector("canvas");
      if (!mirror) continue;
      const page = manifest.lenses[n]?.pageRect;
      const x = page ? page.relLeft * s : (el.getBoundingClientRect().left - hr.left) * s;
      const y = page ? page.relTop * s : (el.getBoundingClientRect().top - hr.top) * s;
      const w = page ? page.w * s : el.getBoundingClientRect().width * s;
      const h = page ? page.h * s : el.getBoundingClientRect().height * s;
      ctx.drawImage(mirror, x, y, w, h);
    }
    ctx.drawImage(chrome, 0, 0);
    return out;
  },
};

export type { MotionFrameBundle, MotionLensHost };
