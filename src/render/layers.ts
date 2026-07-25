// Layer geometry for the WebGL compositor: the composition expressed as an ordered list of
// textured quads instead of a React tree. Pure — same inputs, same list, no DOM and no GL —
// so beat windows, crossfades and camera moves are unit-testable numbers.
//
// Layer order mirrors the stack documented at the top of native/page/KinoVideo.tsx.
import type { KinoProps } from "./props.js";
import { interpolate } from "./interpolate.js";
import { normalizeLayer, type Dims, type LayerDraw, type LayerSpec } from "./native/page/compositor/graph.js";
import { MOTION_XFADE_FRAMES } from "./motion.js";
import { hasCaptionContent } from "./captionLayout.js";

import { kenBurnsScale } from "./backgrounds/glow.js";

export type { Dims };

/** The avatar clip's gentle push-in over its window (KinoVideo.tsx AvatarClip). */
const AVATAR_PUSH_IN = 1.08;

/** Chained-cutaway hold: a held clip extends this many frames into its successor. */
const CHAIN_HOLD_FRAMES = 12;

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
    out.push({ id: `seg${i}`, source: { providerId: footageProvider }, rect, opacity });
    if (s.frame) out.push({ id: `frame${i}`, source: { providerId: `frame${i}` }, rect: full, opacity });
    if (s.kicker) out.push({ id: `kicker${i}`, source: { providerId: `kicker${i}` }, rect: full, opacity });
  });

  // 5. Full-screen motion beats. A motion beat that follows another dissolves in over the
  // overlap; the first one stays opaque so a looping open has no seam.
  props.segments.forEach((s, i) => {
    if (s.kind !== "motion" || !s.motion) return;
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    const fadeIn = props.segments[i - 1]?.kind === "motion";
    const opacity = fadeIn
      ? interpolate(local, [0, MOTION_XFADE_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1;
    out.push({
      id: `motion${i}`,
      source: { providerId: `motion${i}`, key: String(local) },
      rect: full,
      opacity,
    });
  });

  // 6. Motion overlays: layered above whatever their beat drew.
  props.segments.forEach((s, i) => {
    if (!s.motionOverlay) return;
    const from = f(s.startSec);
    const dur = f(s.endSec) - from;
    const local = frame - from;
    if (local < 0 || local >= dur) return;
    out.push({
      id: `overlay${i}`,
      source: { providerId: `overlay${i}`, key: String(local) },
      rect: full,
    });
  });

  // 7. Standalone text overlays (spec `texts[]`), absolute-timed.
  props.segments.forEach((s, i) => {
    s.texts?.forEach((t, j) => {
      const from = f(t.fromSec);
      const to = "durSec" in t ? f(t.fromSec + (t as any).durSec) : f((t as any).toSec);
      if (frame < from || frame >= to) return;
      out.push({ id: `text${i}_${j}`, source: { providerId: `text${i}_${j}` }, rect: full });
    });
  });

  // 8. Logo — presenter-less beats only (the avatar covers it on camera).
  if (props.logo) {
    const onCamera = props.avatar
      ? props.avatarWindows.some((w) => frame >= f(w.fromSec) && frame < f(w.toSec))
      : false;
    const logoFromSec = (props.logo as any).fromSec ?? 0;
    if (!onCamera && frame >= f(logoFromSec)) {
      out.push({ id: "logo", source: { providerId: "logo" }, rect: full });
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
    out.push({ id: `caption${i}`, source: { providerId: `caption${i}`, key }, rect: full });
  });

  // 10. AI disclosure.
  if (props.disclosure) {
    out.push({ id: "disclosure", source: { providerId: "disclosure" }, rect: full });
  }

  // 11. Cinematic finish — vignette and grain over everything. `theme.film === 0` disables it.
  if ((props.theme.film ?? 1) > 0) {
    out.push({ id: "film", source: { providerId: "film" }, rect: full, blend: "normal" });
  }

  return out.map(normalizeLayer);
}
