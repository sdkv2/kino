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
    // Everything hoisted out of the raster, replayed in draw order beneath the plate.
    const hoisted = manifest.quads ?? [];
    const paintHoisted = (c: CanvasRenderingContext2D, w: number, h: number) => {
      if (underlay) c.drawImage(underlay.img, 0, 0, w, h);
      for (const q of hoisted) {
        const plate = quadPlates?.get(q.src);
        if (!plate) continue;
        const cw = q.cell ? plate.img.naturalWidth / q.cell.cols : plate.img.naturalWidth;
        const ch = q.cell ? plate.img.naturalHeight / q.cell.rows : plate.img.naturalHeight;
        const sx = q.cell ? q.cell.col * cw : 0;
        const sy = q.cell ? q.cell.row * ch : 0;
        c.drawImage(plate.img, sx, sy, cw, ch, q.relLeft * s, q.relTop * s, q.w * s, q.h * s);
      }
    };

    paintHoisted(ctx, out.width, out.height);
    ctx.drawImage(sample, 0, 0);
    // The first lens refracts `sample`; with imagery hoisted out of the raster, `sample` alone is
    // a hole where it used to be, so refract the composited stack instead.
    let sampleForLens: HTMLCanvasElement = sample;
    if (underlay || hoisted.length) {
      const merged = document.createElement("canvas");
      merged.width = out.width;
      merged.height = out.height;
      const mc = merged.getContext("2d");
      if (mc) {
        paintHoisted(mc, merged.width, merged.height);
        mc.drawImage(sample, 0, 0);
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
