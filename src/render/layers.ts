// Layer geometry for the WebGL compositor: the composition expressed as an ordered list of
// textured quads instead of a React tree. Pure — same inputs, same list, no DOM and no GL —
// so beat windows, crossfades and camera moves are unit-testable numbers.
//
// Layer order mirrors the stack documented at the top of native/page/KinoVideo.tsx.
import type { BgKeyframe, KinoProps } from "./props.js";
import type { LayerEffect } from "./maskSpec.js";
import { interpolate } from "./interpolate.js";
import { paramsAt } from "./bgparams.js";
import { resolveEffects } from "./effectParams.js";
import { IDENTITY_TRANSFORM, normalizeLayer, type Dims, type LayerDraw, type LayerSpec, type LayerTransform } from "./native/page/compositor/graph.js";
import { motionHandoff, motionXfadeFrames, shotTransform, type Shot } from "./motion.js";
import { hasCaptionContent } from "./captionLayout.js";

import { kenBurnsScale } from "./backgrounds/glow.js";

export type { Dims };

/** The avatar clip's gentle push-in over its window (KinoVideo.tsx AvatarClip). */
const AVATAR_PUSH_IN = 1.08;

/** Chained-cutaway hold: a held clip extends this many frames into its successor. */
const CHAIN_HOLD_FRAMES = 12;

/**
 * Paint order as data. Every built-in layer gets a z; declared layers slot between them.
 *
 * These values are DERIVED from the historical push order plus the film split that used to be
 * decided by an id-prefix regex in the renderer — they are not a fresh design. The gaps are
 * deliberate: they are where a declared layer goes. tests/layer-order-invariance.test.ts is the
 * oracle that says these reproduce the old order; if it fails, these are wrong.
 */
export const Z = {
  backdrop: 0,
  scrim: 100,
  avatar: 200,
  seg: 300,
  frame: 310,
  kicker: 320,
  /** The cinematic finish. Everything below is grained; everything above stays clean. */
  film: 700,
  overlayVideoBehind: 750,
  segBehind: 760,
  overlayMotionBehind: 800,
  motion: 810,
  overlay: 820,
  text: 900,
  caption: 1100,
  disclosure: 1200,
  /** QA guides. Above everything — a safe-zone guide a caption can cover is useless.
   *  NOTE: this is the one constant that does NOT reproduce today's order. Today these ids
   *  match nothing in the renderer's id-prefix band test, so they paint BELOW the film and
   *  behind every caption, contradicting their own comment in §11. Setting them above is a
   *  deliberate fix, and it takes effect in Task 3 (when banding starts reading z), not here. */
  qa: 9000,
} as const;

const num = (v: unknown, d: number): number => (typeof v === "number" ? v : Number(v) || d);

/**
 * An authored tween track (captionKeyframes / kickerKeyframes / zoomKeyframes / a declared
 * layer's own `keyframes`) resolved to a layer transform at `tSec`.
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

/**
 * Fill in an opt-in `{ kind: "motionBlur", params: { auto: 1 } }` from how far this layer actually
 * travelled since the previous frame.
 *
 * Effect params are static for a whole beat, so a hand-authored blur cannot describe a punch — it
 * would smear the entire beat instead of the six frames that are moving. Measuring the transform
 * delta instead means the smear exists only while the camera does, which is the whole reason a
 * fast move reads as expensive rather than as a jump.
 *
 * A pan displaces every pixel by one vector (angle + distance); a scale change displaces each
 * pixel along its own ray from the centre, proportionally (radial). Both are emitted, so a move
 * that pans AND pushes blurs correctly. `shutter` is the fraction of the frame interval the
 * shutter is open — 0.5 is the 180° convention.
 */
function autoMotionBlur(
  effects: LayerEffect[] | undefined,
  cur: LayerTransform | undefined,
  prev: LayerTransform | undefined,
): LayerEffect[] | undefined {
  if (!effects?.length) return effects;
  const isAuto = (e: LayerEffect) => e.kind === "motionBlur" && num(e.params?.auto, 0) > 0;
  if (!effects.some(isAuto)) return effects;

  const c = cur ?? IDENTITY_TRANSFORM;
  const p = prev ?? IDENTITY_TRANSFORM;
  const dx = c.translate[0] - p.translate[0];
  const dy = c.translate[1] - p.translate[1];
  const growth = p.scale > 0 ? c.scale / p.scale - 1 : 0;

  return effects.map((e) => {
    if (!isAuto(e)) return e;
    const shutter = num(e.params?.shutter, 0.5);
    return {
      kind: e.kind,
      params: {
        ...e.params,
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
        distance: Math.hypot(dx, dy) * shutter,
        radial: growth * shutter,
        samples: num(e.params?.samples, 12),
      },
    };
  });
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
    z: Z.backdrop,
    source: { providerId: "backdrop" },
    rect: full,
    transform: bgScale !== 1 ? { scale: bgScale, rotate: 0, translate: [0, 0] } : undefined,
  });

  // The scrim rides above canvas and image backdrops, never above a shader one.
  const shaderBg = props.background.kind === "custom" && Boolean(props.background.shaderCode);
  if (!shaderBg) out.push({ id: "scrim", z: Z.scrim, source: { providerId: "scrim" }, rect: full });

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
        z: Z.avatar,
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

    // One resolution per beat, shared by every layer this beat emits. Beat-local seconds, matching
    // zoomKeyframes/captionKeyframes — see docs/spec-reference.md.
    const beatEffects = resolveEffects(s.effects, local / props.fps);

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
        z: Z.overlayVideoBehind,
        source: { providerId: `overlay${i}`, key: String(local) },
        rect: full,
        opacity,
        effects: beatEffects,
        group: beat,
      });
    }
    // Two cameras. `shot` moves the footage WITHIN its own rect (tx/ty are % of that rect);
    // `zoomKeyframes` moves the whole footage+chrome group (x/y are % of the frame). A framed
    // beat locks the shot — a camera move fights the inset — so the two only ever compose when
    // the footage fills the frame, where both share the frame centre. One LayerTransform then
    // holds both exactly: scale = Z·S, translate = Tz + Z·Ts.
    // Resolved at an arbitrary local frame so the previous frame's camera is available too —
    // auto motion blur is the delta between the two.
    const cameraAt = (l: number): LayerTransform | undefined => {
      const z = tweenAt(s.zoomKeyframes, l / props.fps, dims);
      const sh = shotTransform(
        (s.frame ? "static" : s.shot) as Shot,
        seqDur > 0 ? Math.min(1, Math.max(0, l) / seqDur) : 0,
      );
      if (z === null && sh.scale === 1 && sh.tx === 0 && sh.ty === 0) return undefined;
      const zs = z?.transform?.scale ?? 1;
      const zt = z?.transform?.translate ?? [0, 0];
      return {
        scale: zs * sh.scale,
        rotate: 0,
        translate: [zt[0] + zs * (sh.tx / 100) * rect.w, zt[1] + zs * (sh.ty / 100) * rect.h],
      };
    };
    const zoom = tweenAt(s.zoomKeyframes, local / props.fps, dims);
    const segTransform = cameraAt(local);
    const groupOpacity = opacity * (zoom?.opacity ?? 1);
    // Resolving BEFORE autoMotionBlur means a keyframed `shutter`/`samples` feeds the derivation,
    // while the three channels auto computes from measured travel still win over any keyframe.
    const segEffects = autoMotionBlur(beatEffects, segTransform, cameraAt(local - 1));
    // The chrome rides the same camera, so it smears with the footage — a sharp bezel around a
    // blurred screen reads as a compositing mistake. Only the blur carries over, never the rest
    // of the beat's chain, which was authored for the footage.
    const chromeEffects = segEffects?.filter((e) => e.kind === "motionBlur");

    out.push({ id: `seg${i}`, z: behind ? Z.segBehind : Z.seg, source: { providerId: footageProvider }, rect, opacity: groupOpacity, transform: segTransform, mask: segMask, effects: segEffects, blend: s.blend, group: beat });
    if (s.frame) out.push({ id: `frame${i}`, z: Z.frame, source: { providerId: `frame${i}` }, rect: full, opacity: groupOpacity, transform: zoom?.transform, effects: chromeEffects?.length ? chromeEffects : undefined, group: beat });
    if (s.kicker) {
      const kt = tweenAt(s.kickerKeyframes, local / props.fps, dims);
      out.push({
        id: `kicker${i}`,
        z: Z.kicker,
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
    // Effect keyframes ride the same frozen clock as the graphic's own --progress, so a held
    // beat's effects settle with it instead of continuing to tween through the handoff.
    const beatEffects = resolveEffects(s.effects, beatLocal / props.fps);
    const beat = `beat${i}`;
    const segMask = (s as any).mask;
    if (isTextBehindSubject(segMask, i) && s.motionOverlay) {
      out.push({
        id: `overlay${i}`,
        z: Z.overlayMotionBehind,
        source: { providerId: `overlay${i}`, key: String(beatLocal) },
        rect: full,
        opacity,
        effects: beatEffects,
        group: beat,
      });
    }
    out.push({
      id: `motion${i}`,
      z: Z.motion,
      source: { providerId: `motion${i}`, key: String(beatLocal) },
      rect: full,
      opacity,
      mask: motionMask(segMask, `motion${i}`),
      effects: beatEffects,
      blend: s.blend,
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
    const beatEffects = resolveEffects(s.effects, local / props.fps);
    const beat = `beat${i}`;
    out.push({
      id: `overlay${i}`,
      z: Z.overlay,
      source: { providerId: `overlay${i}`, key: String(local) },
      rect: full,
      mask: (s as any).mask,
      effects: beatEffects,
      group: beat,
    });
  });

  // 7. Standalone text overlays (spec `texts[]`), absolute-timed.
  props.segments.forEach((s, i) => {
    // A text overlay is absolute-timed, but the fallback `effects` it inherits belong to the BEAT,
    // so they resolve on the beat's clock. A text's own `effects` carry no track of their own.
    const beatEffects = resolveEffects(s.effects, (frame - f(s.startSec)) / props.fps);
    s.texts?.forEach((t, j) => {
      const from = f(t.fromSec);
      const to = "durSec" in t ? f(t.fromSec + (t as any).durSec) : f((t as any).toSec);
      if (frame < from || frame >= to) return;
      out.push({
        id: `text${i}_${j}`,
        z: Z.text,
        source: { providerId: `text${i}_${j}` },
        rect: full,
        mask: (t as any).mask ?? (s as any).mask,
        effects: (t as any).effects ?? beatEffects,
        group: `beat${i}`,
      });
    });
  });

  // 9. Captions. The raster is keyed by the ACTIVE WORD, not the frame: a words-mode caption
  // re-rasters once per spoken word, and the per-word pop rides the quad instead.
  props.segments.forEach((s, i) => {
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    if (!hasCaptionContent(s)) return;
    const beatEffects = resolveEffects(s.effects, local / props.fps);

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
      z: Z.caption,
      source: { providerId: `caption${i}`, key },
      rect: full,
      mask: (s as any).mask,
      effects: beatEffects,
      group: `beat${i}`,
      transform: tween?.transform,
      opacity: tween?.opacity,
    });
  });

  // 10. AI disclosure.
  if (props.disclosure) {
    out.push({ id: "disclosure", z: Z.disclosure, source: { providerId: "disclosure" }, rect: full });
  }

  // 11. Still/storyboard QA overlays, above every content layer so nothing hides a safe-zone
  // breach. `kino build` never sets these props.
  if (props.platformGuide) out.push({ id: "platformGuide", z: Z.qa, source: { providerId: "platformGuide" }, rect: full });
  if (props.grid) out.push({ id: "grid", z: Z.qa, source: { providerId: "grid" }, rect: full });

  // 11b. Author-declared layers. They carry their own z, so where they land is decided by the
  // sort rather than by this position in the function.
  for (const d of props.layers ?? []) {
    if (d.adjust?.length) {
      // An adjustment layer spans the whole accumulator — validateLayers rejects fromSec/toSec/
      // segment on one (ADJUST_INCOMPATIBLE_FIELDS), so its own start IS the composition's and
      // its keyframe clock is absolute.
      out.push({ id: d.id, z: d.z, source: null, rect: full, adjust: resolveEffects(d.adjust, frame / props.fps) });
      continue;
    }
    // A segment binding borrows that beat's window; `hold` keeps the layer out of the beat's
    // group so the crossfade happens beneath it instead of taking it along.
    const bound = d.segment !== undefined ? props.segments[d.segment] : undefined;
    const fromSec = bound ? bound.startSec : (d.fromSec ?? 0);
    const toSec = bound ? bound.endSec : d.toSec;
    if (frame < f(fromSec)) continue;
    if (toSec !== undefined && frame >= f(toSec)) continue;

    const r = d.rect;
    const rect = r
      ? { x: (r.x / 100) * width, y: (r.y / 100) * height, w: (r.w / 100) * width, h: (r.h / 100) * height }
      : full;
    // Keyframes read from the layer's own start, so a track authored against a beat-bound layer
    // does not shift when the beat does.
    const localFrame = frame - f(fromSec);
    const tween = tweenAt(d.keyframes, localFrame / props.fps, dims);
    out.push({
      id: d.id,
      z: d.z,
      // Layer-relative content key, exactly as the built-in motion layers pass `String(beatLocal)`.
      // Two consumers need it and both fail silently without one: providers/motion.ts `texture()`
      // resolves `key ?? current ?? …` and would otherwise fall through to `current` — a single
      // mutable field set by whichever prepare() ran last, so the layer can draw another frame's
      // raster. And prefetch.ts keys on `${providerId}\0${key ?? ""}`, which without a key is
      // identical every frame, so `nextFrameKeys` treats the layer as already-prepared and never
      // prefetches it at all. Stateless providers (shader, lottie) ignore the key.
      source: { providerId: d.id, key: String(localFrame) },
      rect,
      blend: d.blend,
      opacity: (d.opacity ?? 1) * (tween?.opacity ?? 1),
      transform: tween?.transform,
      mask: d.mask as LayerSpec["mask"],
      effects: resolveEffects(d.effects, localFrame / props.fps),
      group: bound && !d.hold ? `beat${d.segment}` : undefined,
    });
  }

  // 12. Cinematic finish — an ADJUSTMENT layer over everything beneath it: no texture source of
  // its own, just a chain the renderer runs over whatever has composited by the time it is
  // reached. Emitted by default so an existing spec keeps its look without naming it;
  // `postFx.film` overrides the params, `film: 0` drops the layer entirely.
  //
  // It is pushed last but sorts on z like everything else, so it lands between the grained
  // content (z < Z.film) and the clean type (z >= Z.film) — the split the renderer used to make
  // by hand. Nothing else claims z === Z.film; if a declared layer ever did, push order would
  // put it BELOW the finish, where the retired band test put it above.
  const filmParams = (props.postFx as { film?: Record<string, number> } | undefined)?.film;
  const filmIntensity = filmParams?.intensity ?? props.theme.film ?? 1;
  if (filmIntensity > 0) {
    out.push({
      id: "film",
      z: Z.film,
      source: null,
      rect: full,
      adjust: [{ kind: "film", params: { ...filmParams, intensity: filmIntensity } }],
    });
  }

  // Stable sort: equal z keeps push order, so same-band layers stay in authored sequence.
  // Array.prototype.sort is stable per spec in every engine we target, but the explicit index
  // tiebreak documents the intent and survives anyone swapping in a different sort.
  return out
    .map((spec, i) => ({ spec, i }))
    .sort((a, b) => (a.spec.z ?? 0) - (b.spec.z ?? 0) || a.i - b.i)
    .map(({ spec }) => normalizeLayer(spec));
}
