// Layer geometry for the WebGL compositor: the composition expressed as an ordered list of
// textured quads instead of a React tree. Pure — same inputs, same list, no DOM and no GL —
// so beat windows, crossfades and camera moves are unit-testable numbers.
//
// Layer order mirrors the stack documented at the top of native/page/KinoVideo.tsx.
import type { BgKeyframe, KinoProps } from "./props.js";
import { interpolate } from "./interpolate.js";
import { paramsAt } from "./bgparams.js";
import { spring } from "./spring.js";
import { normalizeLayer, type Dims, type LayerDraw, type LayerSpec, type LayerTransform } from "./native/page/compositor/graph.js";
import { motionHandoff, motionXfadeFrames, shotTransform, type Shot } from "./motion.js";
import { hasCaptionContent } from "./captionLayout.js";

import { kenBurnsScale } from "./backgrounds/glow.js";

export type { Dims };

/** The avatar clip's gentle push-in over its window (KinoVideo.tsx AvatarClip). */
const AVATAR_PUSH_IN = 1.08;

/** Chained-cutaway hold: a held clip extends this many frames into its successor. */
const CHAIN_HOLD_FRAMES = 12;

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : Number(v) || d);

/**
 * An authored tween track (captionKeyframes / kickerKeyframes / zoomKeyframes / logoKeyframes)
 * resolved to a layer transform at `tSec`.
 *
 * Ported from the retired DOM composition's TweenOverlay, which applied
 * `translate(x%, y%) scale(s)` to a full-frame box: x/y are PERCENT OF FRAME, and the scale is
 * about the rect centre — which is exactly the order `modelMatrix` composes, so the mapping is
 * exact rather than approximate. `opacity` is returned separately because some layers already
 * carry one (a chained video fade) and the two multiply.
 */
function tweenAt(
  keyframes: BgKeyframe[] | undefined,
  tSec: number,
  dims: Dims,
): { transform: LayerSpec["transform"]; opacity: number } | null {
  if (!keyframes?.length) return null;
  const p = paramsAt({ x: 0, y: 0, scale: 1, opacity: 1 }, keyframes, tSec);
  return {
    transform: {
      scale: num(p.scale, 1),
      rotate: 0,
      translate: [(num(p.x, 0) / 100) * dims.width, (num(p.y, 0) / 100) * dims.height],
    },
    opacity: num(p.opacity, 1),
  };
}

/** Layer-as-mask clips overlays; the source motion layer stays unmasked when it is the mask source itself. */
function motionMask(mask: unknown, currentLayerId?: string): LayerSpec["mask"] {
  const m = mask as { source?: { kind?: string; layerId?: string } } | undefined;
  if (!m) return undefined;
  if (m.source?.kind === "layer" && m.source.layerId === currentLayerId) return undefined;
  return m as LayerSpec["mask"];
}

/** Inverted layer mask on motion{i} + motionOverlay = title under the subject cutout (expensive-edit z-order). */
function isTextBehindSubject(mask: unknown, motionIndex: number): boolean {
  const m = mask as { source?: { kind?: string; layerId?: string }; invert?: boolean } | undefined;
  return m?.source?.kind === "layer" && m.source.layerId === `motion${motionIndex}` && m.invert === true;
}

/** File cutout mask + motionOverlay on a video beat = title under the segmented subject. */
function isVideoTextBehind(mask: unknown, motionOverlay: unknown, source?: string): boolean {
  const m = mask as { source?: { kind?: string } } | undefined;
  if (!motionOverlay) return false;
  if (m?.source?.kind === "file") return true;
  if (!m && source && /^cutouts\/.+\.png$/i.test(source)) return true;
  return false;
}

export function layersAt(props: KinoProps, frame: number, dims: Dims): LayerDraw[] {
  const { width, height } = dims;
  const full = { x: 0, y: 0, w: width, h: height };
  const f = (sec: number) => Math.round(sec * props.fps);
  const out: LayerSpec[] = [];

  // 1–2. Night fill and brand backdrop are one source: the background provider paints the
  // night colour before it draws, exactly as CanvasBackground does today.
  const bgScale = props.background.kind === "image" ? kenBurnsScale(frame) : 1;
  out.push({
    id: "backdrop",
    source: { providerId: "backdrop" },
    rect: full,
    transform: bgScale !== 1 ? { scale: bgScale, rotate: 0, translate: [0, 0] } : undefined,
  });

  // The scrim rides above canvas and image backdrops, never above a shader one.
  const shaderBg = props.background.kind === "custom" && Boolean(props.background.shaderCode);
  if (!shaderBg) out.push({ id: "scrim", source: { providerId: "scrim" }, rect: full });

  // 3. Avatar windows.
  if (props.avatar) {
    props.avatarWindows.forEach((w, i) => {
      const from = f(w.fromSec);
      const dur = f(w.toSec) - from;
      const local = frame - from;
      if (local < 0 || local >= dur) return;
      const scale = interpolate(local, [0, dur], [1, AVATAR_PUSH_IN], { extrapolateRight: "clamp" });
      out.push({
        id: `av${i}`,
        source: { providerId: `av${i}` },
        rect: full,
        transform: { scale, rotate: 0, translate: [0, 0] },
      });
    });
  }

  // 4. Video beats: footage, optional chrome frame, optional kicker.
  props.segments.forEach((s, i) => {
    if (s.kind !== "video") return;
    const from = f(s.startSec);
    const next = props.segments[i + 1];
    const chained = next?.kind === "video";
    const seqDur = chained ? f(next.startSec) - from + CHAIN_HOLD_FRAMES : f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= seqDur) return;

    // A chained successor fades in over the overlap its predecessor is held through.
    const prev = props.segments[i - 1];
    const fadesIn = prev?.kind === "video";
    const opacity = fadesIn
      ? interpolate(local, [0, CHAIN_HOLD_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;

    const inset = s.frame?.inset;
    const rect = inset
      ? { x: (inset.x * width) / 100, y: (inset.y * height) / 100, w: (inset.w * width) / 100, h: (inset.h * height) / 100 }
      : full;

    const footageProvider = s.regionShader ? `region${i}` : `seg${i}`;
    const beat = `beat${i}`;
    const segMask = (s as any).mask;
    const behind = isVideoTextBehind(segMask, s.motionOverlay, s.kind === "video" ? s.source : undefined);
    if (behind) {
      out.push({
        id: `overlay${i}`,
        source: { providerId: `overlay${i}`, key: String(local) },
        rect: full,
        opacity,
        effects: s.effects,
        group: beat,
      });
    }
    // Two cameras. `shot` moves the footage WITHIN its own rect (tx/ty are % of that rect);
    // `zoomKeyframes` moves the whole footage+chrome group (x/y are % of the frame). A framed
    // beat locks the shot — a camera move fights the inset — so the two only ever compose when
    // the footage fills the frame, where both share the frame centre. One LayerTransform then
    // holds both exactly: scale = Z·S, translate = Tz + Z·Ts.
    const zoom = tweenAt(s.zoomKeyframes, local / props.fps, dims);
    const shot = shotTransform((s.frame ? "static" : s.shot) as Shot, seqDur > 0 ? Math.min(1, local / seqDur) : 0);
    const zScale = zoom?.transform?.scale ?? 1;
    const zTranslate = zoom?.transform?.translate ?? [0, 0];
    const moving = zoom !== null || shot.scale !== 1 || shot.tx !== 0 || shot.ty !== 0;
    const segTransform: LayerTransform | undefined = moving
      ? {
          scale: zScale * shot.scale,
          rotate: 0,
          translate: [
            zTranslate[0] + zScale * (shot.tx / 100) * rect.w,
            zTranslate[1] + zScale * (shot.ty / 100) * rect.h,
          ],
        }
      : undefined;
    const groupOpacity = opacity * (zoom?.opacity ?? 1);

    out.push({ id: `seg${i}`, source: { providerId: footageProvider }, rect, opacity: groupOpacity, transform: segTransform, mask: segMask, effects: s.effects, group: beat, aboveFilm: behind });
    if (s.frame) out.push({ id: `frame${i}`, source: { providerId: `frame${i}` }, rect: full, opacity: groupOpacity, transform: zoom?.transform, group: beat });
    if (s.kicker) {
      const kt = tweenAt(s.kickerKeyframes, local / props.fps, dims);
      out.push({
        id: `kicker${i}`,
        source: { providerId: `kicker${i}` },
        rect: full,
        // The chained-clip fade and the authored track are independent — they multiply.
        opacity: opacity * (kt?.opacity ?? 1),
        transform: kt?.transform,
        group: beat,
      });
    }
  });

  // 5. Full-screen motion beats. Hold the outgoing graphic through the next beat's xfade so the
  // dissolve never drops onto the backdrop; `transition: "cut"` abuts with no overlap.
  props.segments.forEach((s, i) => {
    if (s.kind !== "motion" || !s.motion) return;
    const prev = props.segments[i - 1];
    const next = props.segments[i + 1];
    const nextMotion = next?.kind === "motion" ? next : null;
    const h = motionHandoff({
      startSec: s.startSec,
      endSec: s.endSec,
      nextMotionStartSec: nextMotion ? nextMotion.startSec : null,
      prevIsMotion: prev?.kind === "motion",
      fps: props.fps,
      // Outgoing hold length follows the *incoming* beat's transition.
      xfadeFrames: nextMotion ? motionXfadeFrames(nextMotion.transition) : 0,
      fadeIn: prev?.kind === "motion" && motionXfadeFrames(s.transition) > 0,
    });
    const local = frame - h.from;
    if (local < 0 || local >= h.seqDur) return;
    const opacity = h.fadeIn
      ? interpolate(local, [0, h.xfade], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
    // Freeze --progress at end of authored beat while held into the handoff.
    const beatLocal = Math.min(local, h.beatDur - 1);
    const beat = `beat${i}`;
    const segMask = (s as any).mask;
    if (isTextBehindSubject(segMask, i) && s.motionOverlay) {
      out.push({
        id: `overlay${i}`,
        source: { providerId: `overlay${i}`, key: String(beatLocal) },
        rect: full,
        opacity,
        effects: s.effects,
        group: beat,
      });
    }
    out.push({
      id: `motion${i}`,
      source: { providerId: `motion${i}`, key: String(beatLocal) },
      rect: full,
      opacity,
      mask: motionMask(segMask, `motion${i}`),
      effects: s.effects,
      group: beat,
    });
  });

  // 6. Motion overlays: layered above whatever their beat drew.
  props.segments.forEach((s, i) => {
    if (!s.motionOverlay) return;
    if (isTextBehindSubject((s as any).mask, i)) return;
    if (isVideoTextBehind((s as any).mask, s.motionOverlay, s.kind === "video" ? s.source : undefined)) return;
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    const beat = `beat${i}`;
    out.push({
      id: `overlay${i}`,
      source: { providerId: `overlay${i}`, key: String(local) },
      rect: full,
      mask: (s as any).mask,
      effects: s.effects,
      group: beat,
    });
  });

  // 7. Standalone text overlays (spec `texts[]`), absolute-timed.
  props.segments.forEach((s, i) => {
    s.texts?.forEach((t, j) => {
      const from = f(t.fromSec);
      const to = "durSec" in t ? f(t.fromSec + (t as any).durSec) : f((t as any).toSec);
      if (frame < from || frame >= to) return;
      out.push({
        id: `text${i}_${j}`,
        source: { providerId: `text${i}_${j}` },
        rect: full,
        mask: (t as any).mask ?? (s as any).mask,
        effects: (t as any).effects ?? s.effects,
        group: `beat${i}`,
      });
    });
  });

  // 8. Logo — presenter-less beats only (the avatar covers it on camera).
  if (props.logo) {
    const onCamera = props.avatar
      ? props.avatarWindows.some((w) => frame >= f(w.fromSec) && frame < f(w.toSec))
      : false;
    const logo = props.logo;
    const logoFromSec = (logo as any).fromSec ?? 0;
    if (!onCamera && frame >= f(logoFromSec)) {
      // Ported from AnimatedElement: `left/top` are % of frame under a translate(-50%,-50%),
      // so x/y name the CENTRE, and the mark draws at sizePx wide at its natural aspect —
      // never full-bleed. The track tweens FROM the configured position and reads ABSOLUTE
      // time: logoKeyframes span the whole spec, not a beat (build.ts rebases them per cut).
      // No track → the default entrance: a critically-damped fade-and-settle from 0.9, measured
      // from the mark's own start frame. An authored track replaces it outright.
      const entrance = spring({ frame: frame - f(logoFromSec), fps: props.fps, config: { damping: 200 } });
      const p = logo.keyframes?.length
        ? paramsAt({ x: logo.x, y: logo.y, scale: 1, opacity: 1 }, logo.keyframes, frame / props.fps)
        : { x: logo.x, y: logo.y, scale: interpolate(entrance, [0, 1], [0.9, 1]), opacity: entrance };
      const lw = logo.sizePx;
      const lh = logo.sizePx / (logo.aspect || 1);
      out.push({
        id: "logo",
        source: { providerId: "logo" },
        rect: {
          x: (num(p.x, logo.x) / 100) * width - lw / 2,
          y: (num(p.y, logo.y) / 100) * height - lh / 2,
          w: lw,
          h: lh,
        },
        transform: { scale: num(p.scale, 1), rotate: 0, translate: [0, 0] },
        opacity: num(p.opacity, 1),
      });
    }
  }

  // 9. Captions. The raster is keyed by the ACTIVE WORD, not the frame: a words-mode caption
  // re-rasters once per spoken word, and the per-word pop rides the quad instead.
  props.segments.forEach((s, i) => {
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    if (!hasCaptionContent(s)) return;

    let key = "phrase";
    if (s.captionMode === "words" && s.words?.length) {
      const tAbs = frame / props.fps;
      let idx = 0;
      for (let w = 0; w < s.words.length; w++) if (tAbs >= s.words[w].start) idx = w;
      key = `w${idx}`;
    }
    const tween = tweenAt(s.captionKeyframes, local / props.fps, dims);
    out.push({
      id: `caption${i}`,
      source: { providerId: `caption${i}`, key },
      rect: full,
      mask: (s as any).mask,
      effects: s.effects,
      group: `beat${i}`,
      transform: tween?.transform,
      opacity: tween?.opacity,
    });
  });

  // 10. AI disclosure.
  if (props.disclosure) {
    out.push({ id: "disclosure", source: { providerId: "disclosure" }, rect: full });
  }

  // 11. Still/storyboard QA overlays, above every content layer so nothing hides a safe-zone
  // breach. `kino build` never sets these props.
  if (props.platformGuide) out.push({ id: "platformGuide", source: { providerId: "platformGuide" }, rect: full });
  if (props.grid) out.push({ id: "grid", source: { providerId: "grid" }, rect: full });

  // 12. Cinematic finish — vignette and grain over everything. `theme.film === 0` disables it.
  // Under the compositor the post stage owns film; the DOM path still uses the html layer.
  return out.map(normalizeLayer);
}
