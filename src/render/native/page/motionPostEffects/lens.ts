// Backdrop-sampling lenses (`kino-lens` + `data-lens` materials) after motion raster.
import { applyLensMirrors } from "../lensMirror.js";
import { peekBackdrop, peekBackdropTexture, registerBackdrop, registerMergedBackdrop } from "../backdrop.js";
import { KINO_DEFS, motionScrubCss } from "../motionCss.js";
import { LENS_CLASS_RE, LENS_SELECTOR } from "../../../lensContract.js";
import { compositeLensLayer, lensStackOrder } from "./lensComposite.js";
import type { MotionPostEffect, MotionPostResult } from "./types.js";

export const lensPostEffect: MotionPostEffect = {
  test: (html) => LENS_CLASS_RE.test(html),
  apply({ field, chrome, html, vars, width, height, gl, lensShaders }): MotionPostResult {
    const shaders = lensShaders ?? {};
    if (!field || !chrome) return field ?? chrome ?? document.createElement("canvas");

    const host = document.createElement("div");
    host.style.cssText = `position:absolute;left:-99999px;top:0;width:${width}px;height:${height}px;visibility:hidden`;
    for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${motionScrubCss(":host")}</style>${KINO_DEFS}${html}`;
    document.body.appendChild(host);

    const s = width > 0 ? field.width / width : 1;
    const hr = host.getBoundingClientRect();
    const stack = lensStackOrder(Array.from(shadow.querySelectorAll<HTMLElement>(LENS_SELECTOR)));
    const underCompositor = peekBackdrop();
    const underCompositorTex = peekBackdropTexture();

    if (gl && underCompositorTex && stack.length > 0) {
      const gpu = compositeLensLayer({
        gl,
        field,
        chrome,
        backdrop: underCompositorTex,
        pageW: width,
        pageH: height,
        hostRect: hr,
        stack,
        lensShaders: shaders,
      });
      host.remove();
      if (gpu) return gpu;
    }

    const out = document.createElement("canvas");
    out.width = field.width;
    out.height = field.height;
    const ctx = out.getContext("2d");
    if (!ctx) {
      host.remove();
      return field;
    }
    ctx.drawImage(field, 0, 0);
    let stackBackdrop: HTMLCanvasElement | null = null;
    for (let n = 0; n < stack.length; n++) {
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
        registerMergedBackdrop(field, underCompositor);
      }
      const el = stack[n];
      applyLensMirrors(shadow, { elements: [el], lensShaders: shaders });
      const mirror = el.querySelector("canvas");
      if (!mirror) continue;
      const r = el.getBoundingClientRect();
      const x = (r.left - hr.left) * s;
      const y = (r.top - hr.top) * s;
      const w = r.width * s;
      const h = r.height * s;
      ctx.drawImage(mirror, x, y, w, h);
    }
    ctx.drawImage(chrome, 0, 0);
    host.remove();
    return out;
  },
};
