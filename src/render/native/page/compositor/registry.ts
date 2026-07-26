// Builds one TextureSource per layer id that `layersAt` can emit. The ids here and the
// providerIds in layers.ts are the same namespace — a mismatch means a silently missing
// layer, so both sides are exercised by the parity harness.
import type { BackgroundProps, KinoProps } from "../../../props.js";
import type { MediaMap } from "../media.js";
import type { Dims, TextureSource } from "./graph.js";

export type { Dims };
import { createCanvas2dSource } from "./providers/canvas2d.js";
import { createFramesSource } from "./providers/frames.js";
import { createHtmlSource } from "./providers/html.js";
import { createImageSource } from "./providers/image.js";
import { createLottieSource } from "./providers/lottie.js";
import { createMotionSource } from "./providers/motion.js";
import { createShaderSource } from "./providers/shader.js";
import { createRegionCompositorSource } from "./regionHost.js";
import { createShaderDraw } from "./shaderHost.js";
import { getPreset, type DrawFn } from "../../../backgrounds/presets.js";
import { glowDraw, scrimDraw } from "../../../backgrounds/glow.js";

/**
 * Which draw function paints this background — mirroring FacelessBackdrop's resolution order.
 *
 * TRUST BOUNDARY: `new Function()` executes config-supplied code. Safe ONLY because the source
 * is trusted local project config that has already passed the sanitize + determinism lint
 * (sanitizeMotion.ts, motiongraphic.ts). Never feed untrusted or remote input here.
 */
export function resolveBackgroundDraw(bg: BackgroundProps): DrawFn | undefined {
  if (bg.kind === "custom" && bg.customCode) {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function("ctx", "env", bg.customCode) as DrawFn;
  }
  return getPreset(bg.kind);
}

import { captionMarkup, kickerMarkup, textMarkup, disclosureMarkup } from "./textMarkup.js";
import { captionBandBottom, hasCaptionContent, isHeroCaption } from "../../../captionLayout.js";

export function buildRegistry(
  props: KinoProps,
  renderDims: Dims,
  compDims: Dims,
  media: MediaMap,
  scale: number,
): Map<string, TextureSource> {
  // Backdrops, scrims and lottie draw resolution-independently, so they paint at the full
  // supersampled size. Markup rasters are different: their content is authored in composition
  // pixels (caption font sizes, `top: 480px` in a motion graphic), so they must LAY OUT at
  // composition size and gain their supersample from the raster `scale` instead. Laying markup
  // out at renderDims renders every authored px at 1/ss of its intended size.
  const dims = renderDims;
  const sources = new Map<string, TextureSource>();
  const f = (sec: number) => Math.round(sec * props.fps);

  const shaderBg = props.background.kind === "custom" && Boolean(props.background.shaderCode);

  // Backdrop.
  if (shaderBg) {
    sources.set(
      "backdrop",
      createShaderSource({
        drawFrame: createShaderDraw({
          shaderSrc: props.background.shaderCode!,
          params: props.background.params,
          keyframes: props.background.keyframes,
          triggers: props.background.triggers,
          width: dims.width,
          height: dims.height,
          fps: props.fps,
        }),
        width: dims.width,
        height: dims.height,
        params: props.background.params,
        keyframes: props.background.keyframes,
        triggers: props.background.triggers,
      }),
    );
  } else {
    const draw = resolveBackgroundDraw(props.background) ?? glowDraw;
    sources.set(
      "backdrop",
      createCanvas2dSource({
        draw,
        params: {
          ...props.background.params,
          night: props.theme.night,
          green: props.theme.green,
          mint: props.theme.mint,
          gold: props.theme.gold,
        },
        keyframes: props.background.keyframes,
        triggers: props.background.triggers,
        theme: props.theme,
        width: dims.width,
        height: dims.height,
        fps: props.fps,
      }),
    );
  }

  // Scrim layer (for non-shader backdrops)
  if (!shaderBg) {
    sources.set(
      "scrim",
      createCanvas2dSource({
        draw: scrimDraw,
        params: {
          ...props.background.params,
          night: props.theme.night,
        },
        keyframes: [],
        triggers: [],
        theme: props.theme,
        width: dims.width,
        height: dims.height,
        fps: props.fps,
        clearNight: false,
      }),
    );
  }

  props.avatarWindows.forEach((w, i) => {
    const entry = media[`av${i}`];
    if (entry) sources.set(`av${i}`, createFramesSource(entry, f(w.fromSec)));
  });

  props.segments.forEach((s, i) => {
    if (s.kind === "video") {
      if (s.regionShader) {
        sources.set(
          `region${i}`,
          createRegionCompositorSource({
            region: s.regionShader,
            theme: props.theme,
            width: compDims.width,
            height: compDims.height,
            fps: props.fps,
            beatFrom: f(s.startSec),
            beatDur: f(s.endSec) - f(s.startSec),
            assetRel: s.source!,
            assetMediaKey: s.source && /\.(mp4|mov)$/i.test(s.source) ? `seg${i}` : undefined,
            maskMediaKeys: s.regionShader.masks.map((m, j) => (m.maskKind === "video" ? `rsmask${i}_${j}` : undefined)),
            backdropMediaKey:
              s.regionShader.backdrop && /\.(mp4|mov)$/i.test(s.regionShader.backdrop) ? `rsbd${i}` : undefined,
            media,
          }),
        );
      } else {
        const entry = media[`seg${i}`];
        if (entry) sources.set(`seg${i}`, createFramesSource(entry, f(s.startSec)));
      }
      if (s.frame) sources.set(`frame${i}`, createImageSource("/public/" + s.frame.src));
    }
    if (s.kicker) {
      sources.set(
        `kicker${i}`,
        createHtmlSource({
          html: kickerMarkup({ text: s.kicker.text, color: s.kicker.color, fg: s.kicker.fg, theme: props.theme }),
          theme: props.theme,
          size: { w: compDims.width, h: compDims.height },
          fps: props.fps,
          hasTier2: false,
          scale,
        }),
      );
    }
    s.texts?.forEach((t, j) => {
      sources.set(
        `text${i}_${j}`,
        createHtmlSource({
          html: textMarkup({ overlay: t, theme: props.theme }),
          theme: props.theme,
          size: { w: compDims.width, h: compDims.height },
          fps: props.fps,
          hasTier2: false,
          scale,
        }),
      );
    });
    if (hasCaptionContent(s)) {
      sources.set(
        `caption${i}`,
        createHtmlSource({
          html: (frame: number, key?: string) => {
            const activeWord = key && key.startsWith("w") ? parseInt(key.slice(1), 10) : null;
            const tAbs = s.startSec + frame / props.fps;
            return captionMarkup({
              text: s.caption ?? "",
              words: s.words,
              tAbs,
              theme: props.theme,
              hero: isHeroCaption(s, Boolean(props.avatar)),
              activeWord: Number.isNaN(activeWord) ? null : activeWord,
            });
          },
          theme: props.theme,
          size: { w: compDims.width, h: compDims.height },
          fps: props.fps,
          hasTier2: false,
          scale,
        }),
      );
    }
    const motionSource = (data: NonNullable<typeof s.motion>, beatFrom: number, beatDur: number) => {
      if (data.lottie) {
        return createLottieSource({
          data,
          width: dims.width,
          height: dims.height,
          fps: props.fps,
          beatFrom,
          beatDur,
        });
      }
      return createMotionSource({
        data,
        theme: props.theme,
        width: compDims.width,
        height: compDims.height,
        fps: props.fps,
        scale,
        beatFrom,
        beatDur,
        captionBottom: captionBandBottom(s, Boolean(props.avatar)),
      });
    };
    if (s.kind === "motion" && s.motion) {
      sources.set(`motion${i}`, motionSource(s.motion, f(s.startSec), f(s.endSec) - f(s.startSec)));
    }
    if (s.motionOverlay) {
      sources.set(`overlay${i}`, motionSource(s.motionOverlay, f(s.startSec), f(s.endSec) - f(s.startSec)));
    }
  });

  if (props.logo) sources.set("logo", createImageSource("/public/" + props.logo.src));

  if (props.disclosure) {
    sources.set(
      "disclosure",
      createHtmlSource({
        html: disclosureMarkup({ text: props.disclosure, theme: props.theme }),
        theme: props.theme,
        size: { w: compDims.width, h: compDims.height },
        fps: props.fps,
        hasTier2: false,
        scale,
      }),
    );
  }

  // Film finish is a GL post pass under the compositor — see post.ts / filmPass.

  return sources;
}
