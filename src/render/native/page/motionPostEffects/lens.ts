// Backdrop-sampling lenses (`kino-lens` + `data-lens` materials) after motion raster.
import { applyLensMirrors } from "../lensMirror.js";
import { peekBackdrop, peekBackdropTexture, registerBackdrop, registerMergedBackdrop } from "../backdrop.js";
import type { MotionFrameBundle, MotionLensHost } from "../lensLayout.js";
import { executeLensCompositeNode } from "../lensCompositeNode.js";
import type { MotionPostEffect, MotionPostResult } from "./types.js";
import { LENS_CLASS_RE } from "../../../lensContract.js";

export const lensPostEffect: MotionPostEffect = {
  test: (html) => LENS_CLASS_RE.test(html),
  apply({ sample, chrome, manifest, plates, lensHost, html, width, height, gl, underlay, quadPlates, lensShaders }): MotionPostResult {
    const shaders = lensShaders ?? {};
    if (!sample || !chrome || !manifest || !plates) return sample ?? chrome ?? document.createElement("canvas");

    const underCompositor = peekBackdrop();
    const underCompositorTex = peekBackdropTexture();

    if (gl && underCompositorTex) {
      // No mip chain: measured on macos-desktop-youtube it changed draft output ~0.33% RMSE with
      // no visible difference, and at SS=2 the backplate is MAGNIFIED to the layer so MIN_FILTER
      // never engages at final quality. Worth revisiting for a detailed photographic backplate
      // that genuinely minifies — uploadCanvasOrImage takes { mipmap: true } for that.
      const underTex = underlay?.texture(gl) ?? null;
      const gpu = executeLensCompositeNode({
        gl,
        manifest,
        plates,
        backdrop: underCompositorTex,
        underlay: underTex
          ? { tex: underTex, width: underlay!.img.naturalWidth, height: underlay!.img.naturalHeight }
          : null,
        quadTex: (src) => {
          const plate = quadPlates?.get(src);
          const tex = plate?.texture(gl);
          return tex ? { tex, width: plate!.img.naturalWidth, height: plate!.img.naturalHeight } : null;
        },
        lensShaders: shaders,
      });
      if (gpu) return gpu;
    }

    const host = lensHost;
    if (!host && !plates.foreground) return sample;

    const out = document.createElement("canvas");
    out.width = sample.width;
    out.height = sample.height;
    const ctx = out.getContext("2d");
    if (!ctx) return sample;

    const s = width > 0 ? sample.width / width : 1;
    const hr = host?.texRoot.getBoundingClientRect();
    const hoisted = manifest.quads ?? [];
    const paintUnderlay = (c: CanvasRenderingContext2D, w: number, h: number) => {
      if (underlay) c.drawImage(underlay.img, 0, 0, w, h);
    };
    // Same order as the GPU node: quads paint ABOVE the sample plate (a quad nested in an opaque
    // page can never show through from below), with the measured clip crop + corner radius. The
    // two paths used to disagree here, so stills (CPU) QA'd a different z-order than videos (GPU).
    const paintQuads = (c: CanvasRenderingContext2D) => {
      for (const q of hoisted) {
        const plate = quadPlates?.get(q.src);
        if (!plate) continue;
        const cw = q.cell ? plate.img.naturalWidth / q.cell.cols : plate.img.naturalWidth;
        const ch = q.cell ? plate.img.naturalHeight / q.cell.rows : plate.img.naturalHeight;
        const sx = q.cell ? q.cell.col * cw : 0;
        const sy = q.cell ? q.cell.row * ch : 0;
        const cr = q.crop;
        const dx = q.relLeft * s;
        const dy = q.relTop * s;
        const dw = q.w * s;
        const dh = q.h * s;
        const r = (q.radius ?? 0) * s;
        if (r > 0) {
          c.save();
          c.beginPath();
          c.roundRect(dx, dy, dw, dh, r);
          c.clip();
        }
        c.drawImage(
          plate.img,
          sx + (cr ? cr.u0 * cw : 0),
          sy + (cr ? cr.v0 * ch : 0),
          cr ? (cr.u1 - cr.u0) * cw : cw,
          cr ? (cr.v1 - cr.v0) * ch : ch,
          dx,
          dy,
          dw,
          dh,
        );
        if (r > 0) c.restore();
      }
    };

    paintUnderlay(ctx, out.width, out.height);
    ctx.drawImage(sample, 0, 0);
    paintQuads(ctx);
    // The first lens refracts `sample`; with imagery hoisted out of the raster, `sample` alone is
    // a hole where it used to be, so refract the composited stack instead.
    let sampleForLens: HTMLCanvasElement = sample;
    if (underlay || hoisted.length) {
      const merged = document.createElement("canvas");
      merged.width = out.width;
      merged.height = out.height;
      const mc = merged.getContext("2d");
      if (mc) {
        paintUnderlay(mc, merged.width, merged.height);
        mc.drawImage(sample, 0, 0);
        paintQuads(mc);
        sampleForLens = merged;
      }
    }
    if (host) {
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
          registerMergedBackdrop(sampleForLens, underCompositor);
        }
        const el = host.stack[n]!;
        applyLensMirrors(host.texRoot, { elements: [el], lensShaders: shaders });
        const mirror = el.querySelector("canvas");
        if (!mirror) continue;
        const page = manifest.lenses[n]?.pageRect;
        const x = page ? page.relLeft * s : (el.getBoundingClientRect().left - (hr?.left ?? 0)) * s;
        const y = page ? page.relTop * s : (el.getBoundingClientRect().top - (hr?.top ?? 0)) * s;
        const w = page ? page.w * s : el.getBoundingClientRect().width * s;
        const h = page ? page.h * s : el.getBoundingClientRect().height * s;
        ctx.drawImage(mirror, x, y, w, h);
      }
    }
    ctx.drawImage(chrome, 0, 0);
    if (plates.foreground) ctx.drawImage(plates.foreground, 0, 0);
    return out;
  },
};

export type { MotionFrameBundle, MotionLensHost };
