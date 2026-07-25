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
import { createRegionSource } from "./providers/region.js";
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

import { captionMarkup, kickerMarkup, textMarkup, disclosureMarkup, filmMarkup } from "./textMarkup.js";
import { hasCaptionContent, isHeroCaption } from "../../../captionLayout.js";

export function buildRegistry(
  props: KinoProps,
  dims: Dims,
  media: MediaMap,
  scale: number,
): Map<string, TextureSource> {
  const sources = new Map<string, TextureSource>();
  const f = (sec: number) => Math.round(sec * props.fps);

  // Backdrop.
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

  // Scrim layer (for non-shader backdrops)
  const shaderBg = props.background.kind === "custom" && Boolean(props.background.shaderCode);
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
      const entry = media[`seg${i}`];
      if (entry) sources.set(`seg${i}`, createFramesSource(entry, f(s.startSec)));
      if (s.frame) sources.set(`frame${i}`, createImageSource("/public/" + s.frame.src));
    }
    if (s.kicker) {
      sources.set(
        `kicker${i}`,
        createHtmlSource({
          html: kickerMarkup({ text: s.kicker.text, color: s.kicker.color, fg: s.kicker.fg, theme: props.theme }),
          theme: props.theme,
          size: { w: dims.width, h: dims.height },
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
          size: { w: dims.width, h: dims.height },
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
          html: captionMarkup({
            text: s.caption ?? "",
            theme: props.theme,
            hero: isHeroCaption(s, Boolean(props.avatar)),
            activeWord: null,
          }),
          theme: props.theme,
          size: { w: dims.width, h: dims.height },
          fps: props.fps,
          hasTier2: false,
          scale,
        }),
      );
    }
    const html = (kind: "motion" | "overlay", markup: string) =>
      createHtmlSource({
        html: markup,
        theme: props.theme,
        size: { w: dims.width, h: dims.height },
        fps: props.fps,
        hasTier2: kind === "motion" ? Boolean(s.motion?.proc) : Boolean(s.motionOverlay?.proc),
        scale,
      });
    if (s.kind === "motion" && s.motion) sources.set(`motion${i}`, html("motion", s.motion.html));
    if (s.motionOverlay) sources.set(`overlay${i}`, html("overlay", s.motionOverlay.html));
  });

  if (props.logo) sources.set("logo", createImageSource("/public/" + props.logo.src));

  if (props.disclosure) {
    sources.set(
      "disclosure",
      createHtmlSource({
        html: disclosureMarkup({ text: props.disclosure, theme: props.theme }),
        theme: props.theme,
        size: { w: dims.width, h: dims.height },
        fps: props.fps,
        hasTier2: false,
        scale,
      }),
    );
  }

  if ((props.theme.film ?? 1) > 0) {
    sources.set(
      "film",
      createHtmlSource({
        html: filmMarkup({ theme: props.theme, frame: 0 }),
        theme: props.theme,
        size: { w: dims.width, h: dims.height },
        fps: props.fps,
        hasTier2: false,
        scale,
      }),
    );
  }

  return sources;
}
