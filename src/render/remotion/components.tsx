import React from "react";
import { AbsoluteFill, Easing, Img, OffthreadVideo, continueRender, delayRender, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme, BackgroundProps, WordTiming, BgKeyframe } from "../props";
import { shotTransform, type Shot, type Transition } from "../motion";
import { activeWordIndex, isHighlightWord, normWord } from "../captions";
import { paramsAt } from "../bgparams";
import { CanvasBackground } from "./backgrounds/CanvasBackground";
import { getPreset, type DrawFn } from "./backgrounds/presets";
// CAPTION_BOTTOM: px offset of the lower-third caption band from the frame bottom (defined +
// documented in captionLayout.ts; also exposed to motion graphics as --kino-caption-bottom).
import { CAPTION_BOTTOM } from "../captionLayout";
import { wordStyle, lineBoxStyle, animatePreset, composeFilters, type CaptionStyle, type CaptionAnimation, type CaptionReveal, type ResolvedText } from "../textStyles";

const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

// Relative luminance (0 dark → 1 light) of a #hex, so the finish/backdrop can adapt to a light
// "paper" brand vs a dark neon one without any schema change (reads theme.night directly).
const luminance = (hex: string): number => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * (r || 0) + 0.7152 * (g || 0) + 0.0722 * (b || 0);
};

// Loads a downloaded registry TTF before rendering, under `family` (theme.font/theme.labelFont
// reference "KinoBrandFont"/"KinoLabelFont" by name). No-op when using a system font. Two font
// slots share this loader: the caption font and a second `labelFont` motion beats can opt into
// via --kino-label-font, for brands that pair a display face with a mono/label face.
export const FontLoader: React.FC<{ url?: string | null; family?: string }> = ({ url, family = "KinoBrandFont" }) => {
  const [handle] = React.useState(() => (url ? delayRender(`brand-font:${family}`) : null));
  React.useEffect(() => {
    if (!url || handle === null) return;
    const ff = new FontFace(family, `url(${staticFile(url)})`);
    ff.load()
      .then((f) => {
        document.fonts.add(f);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [url, family, handle]);
  return null;
};

export const Caption: React.FC<{ text: string; t: Theme; backplate?: { bg: string } | null; styleName?: CaptionStyle; anim?: CaptionAnimation }> = ({
  text,
  t,
  backplate,
  styleName = "stroke",
  anim,
}) => {
  const f = useCurrentFrame();
  // Entrance spring 0→1; damping 14 / mass 0.6 = a soft pop with a touch of overshoot. Native
  // entrance (pop) keeps the exact legacy math; other presets come from animatePreset.
  const s = spring({ frame: f, fps: 30, config: { damping: 14, mass: 0.6 } });
  const a =
    !anim || anim === "pop"
      ? { transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`, opacity: 1, filter: undefined as string | undefined }
      : animatePreset(anim, { s, frame: f, index: 0 });
  const ink = wordStyle(styleName, t, { shadow: "0 6px 20px rgba(0,0,0,.45)" });
  return (
    <div style={{ position: "absolute", left: 48, right: 48, bottom: CAPTION_BOTTOM, display: "flex", justifyContent: "center" }}>
      <span
        style={{
          fontFamily: t.font,
          fontSize: t.captionFontSize,
          textAlign: "center",
          lineHeight: 1.03,
          letterSpacing: "-0.01em",
          whiteSpace: "pre-line",
          ...ink,
          ...lineBoxStyle(styleName, t, backplate?.bg),
          transform: a.transform,
          opacity: a.opacity,
          filter: composeFilters(ink.filter as string | undefined, a.filter),
        }}
      >
        {text}
      </span>
    </div>
  );
};

// Standalone stylised text overlay (spec `texts[]`): a one-line headline at a named slot, using
// the same style/animation presets as captions. Anchored at its centre like AnimatedElement.
export const TextOverlay: React.FC<{ o: ResolvedText; t: Theme }> = ({ o, t }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 14, mass: 0.6 } });
  const a = animatePreset(o.animation, { s, frame: f, index: 0 });
  const ink = wordStyle(o.style, t, {});
  return (
    <div style={{ position: "absolute", left: `${o.x}%`, top: `${o.y}%`, transform: "translate(-50%, -50%)", maxWidth: "86%", display: "flex", justifyContent: "center" }}>
      <span
        style={{
          fontFamily: t.font,
          fontSize: o.sizePx,
          textAlign: "center",
          lineHeight: 1.05,
          whiteSpace: "pre-line",
          ...ink,
          ...lineBoxStyle(o.style, t, null),
          transform: a.transform,
          opacity: a.opacity,
          filter: composeFilters(ink.filter as string | undefined, a.filter),
        }}
      >
        {o.text}
      </span>
    </div>
  );
};

// Faceless talking beats: the text IS the visual. Big, centered, word-by-word cascade (native
// entrance: rise) so the frame is full and alive instead of a small lower-third line.
export const HeroCaption: React.FC<{ text: string; t: Theme; styleName?: CaptionStyle; anim?: CaptionAnimation }> = ({
  text,
  t,
  styleName = "stroke",
  anim,
}) => {
  const f = useCurrentFrame();
  const words = text.split(" ");
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 80px" }}>
      {/* lineBoxStyle first: its highlight-plate display:inline-block must not clobber the flex
          word row (flex owns columnGap — losing it collapses the gaps between words). */}
      <div style={{ ...lineBoxStyle(styleName, t, null), display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: 22, rowGap: 6 }}>
        {words.map((w, i) => {
          // `i * 3` = 3-frame stagger per word (left→right cascade). Spring damping 13 / mass 0.7.
          // 1.42 scales the hero font 42% above the lower-third caption size.
          const s = spring({ frame: f - i * 3, fps: 30, config: { damping: 13, mass: 0.7 } });
          const a =
            !anim || anim === "rise"
              ? { transform: `translateY(${interpolate(s, [0, 1], [44, 0])}px)`, opacity: interpolate(s, [0, 1], [0, 1]), filter: undefined as string | undefined }
              : animatePreset(anim, { s, frame: f - i * 3, index: i });
          const ink = wordStyle(styleName, t, { shadow: "0 8px 28px rgba(0,0,0,.5)" });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                fontFamily: t.font,
                fontSize: Math.round(t.captionFontSize * 1.42),
                lineHeight: 1.04,
                letterSpacing: "-0.015em",
                ...ink,
                transform: a.transform,
                opacity: a.opacity,
                filter: composeFilters(ink.filter as string | undefined, a.filter),
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// Center scrim that keeps hero text legible over a busy background (derived from the brand night).
// Luminance-adaptive: on a dark brand it's a gentle centre-darken for legibility (not the old
// near-opaque black hole that hollowed out sparse backgrounds); on a light "paper" brand it's a
// whisper so it stops pouring paper over the centre and washing the background out.
const Scrim: React.FC<{ t: Theme }> = ({ t }) => {
  const light = luminance(t.night) > 0.5;
  const a0 = light ? "33" : "9c"; // centre alpha (hex): paper barely touches, night darkens gently
  const a1 = light ? "14" : "2e";
  return <AbsoluteFill style={{ background: `radial-gradient(ellipse 76% 50% at 50% 48%, ${t.night}${a0}, ${t.night}${a1} 66%, ${t.night}00)` }} />;
};

// Three soft brand glows drifting over night (the zero-config default), on a subtle graded base so
// the frame has vertical depth instead of one flat fill. Richer + brighter than a bare two-blob glow.
const GlowBg: React.FC<{ t: Theme }> = ({ t }) => {
  const f = useCurrentFrame();
  const dx = Math.sin(f / 60) * 6;
  const dy = Math.cos(f / 80) * 8;
  const dx2 = Math.cos(f / 52) * 5;
  const base = `linear-gradient(160deg, ${t.night} 0%, ${t.green}1e 55%, ${t.night} 100%)`;
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: base }} />
      <div style={{ position: "absolute", top: `${16 + dy}%`, left: `${10 + dx}%`, width: 980, height: 980, borderRadius: "50%", background: `radial-gradient(circle, ${t.green}66, transparent 62%)`, filter: "blur(44px)" }} />
      <div style={{ position: "absolute", bottom: `${6 - dy}%`, right: `${6 + dx}%`, width: 820, height: 820, borderRadius: "50%", background: `radial-gradient(circle, ${t.mint}3d, transparent 62%)`, filter: "blur(52px)" }} />
      <div style={{ position: "absolute", top: `${52 + dy}%`, left: `${58 + dx2}%`, width: 560, height: 560, borderRadius: "50%", background: `radial-gradient(circle, ${t.gold}24, transparent 64%)`, filter: "blur(58px)" }} />
    </AbsoluteFill>
  );
};

// Static brand image with a slow Ken-Burns push-in.
const ImageBg: React.FC<{ src: string; t: Theme }> = ({ src, t }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, 300], [1.05, 1.13], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, overflow: "hidden" }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

// Dispatcher: glow = CSS drift; image = Ken-Burns photo; mesh/aurora/particles/grid = canvas
// presets; custom = the brand's own draw fn. Animated backgrounds get the legibility scrim.
export const FacelessBackdrop: React.FC<{ t: Theme; background: BackgroundProps }> = ({ t, background }) => {
  const { kind, customCode, params, keyframes, triggers, image } = background;
  const draw = React.useMemo<DrawFn | undefined>(() => {
    if (kind === "custom" && customCode) {
      // TRUST BOUNDARY: new Function() executes config-supplied code. This is safe ONLY because the
      // source is trusted local project config that has already passed the sanitize + determinism lint
      // (sanitize: src/render/sanitizeMotion.ts; lint: src/render/motiongraphic.ts). Never feed untrusted/remote input here.
      // brand-authored draw fn, runs per frame inside CanvasBackground.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      return new Function("ctx", "env", customCode) as DrawFn;
    }
    return getPreset(kind);
  }, [kind, customCode]);

  if (kind === "image" && image) {
    return (
      <AbsoluteFill>
        <ImageBg src={staticFile(image)} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  if (draw) {
    return (
      <AbsoluteFill>
        <CanvasBackground draw={draw} params={params} keyframes={keyframes} triggers={triggers} t={t} />
        <Scrim t={t} />
      </AbsoluteFill>
    );
  }
  return <GlowBg t={t} />;
};

const numOf = (v: unknown, d: number) => (typeof v === "number" ? v : Number(v) || d);

// Reusable overlay layer: positions children at (x%, y%) anchored at their centre, and tweens
// x/y/scale/opacity from an agent keyframe track (absolute time = fromSec + local frame). With no
// keyframes it does a gentle entrance (when defaultEntrance). Captions/kickers can adopt this too.
export const AnimatedElement: React.FC<{
  x: number;
  y: number;
  keyframes: BgKeyframe[];
  fromSec: number;
  defaultEntrance?: boolean;
  children: React.ReactNode;
}> = ({ x, y, keyframes, fromSec, defaultEntrance, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let px = x;
  let py = y;
  let scale = 1;
  let opacity = 1;
  if (keyframes.length) {
    const p = paramsAt({ x, y, scale: 1, opacity: 1 }, keyframes, fromSec + frame / fps);
    px = numOf(p.x, x);
    py = numOf(p.y, y);
    scale = numOf(p.scale, 1);
    opacity = numOf(p.opacity, 1);
  } else if (defaultEntrance) {
    const s = spring({ frame, fps, config: { damping: 200 } });
    opacity = s;
    scale = interpolate(s, [0, 1], [0.9, 1]);
  }
  return (
    <div style={{ position: "absolute", left: `${px}%`, top: `${py}%`, transform: `translate(-50%, -50%) scale(${scale})`, opacity }}>
      {children}
    </div>
  );
};

// Tween wrapper for elements that already position themselves (captions, kickers). Keyframes offset
// (x/y as % of frame), scale, and fade them over absolute time. No keyframes → pass-through (no change,
// so the default look is preserved exactly).
export const TweenOverlay: React.FC<{ keyframes: BgKeyframe[]; children: React.ReactNode }> = ({ keyframes, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  if (!keyframes.length) return <>{children}</>;
  // per-segment elements: `at` is relative to the segment start (local frame)
  const p = paramsAt({ x: 0, y: 0, scale: 1, opacity: 1 }, keyframes, frame / fps);
  return (
    <AbsoluteFill style={{ transform: `translate(${numOf(p.x, 0)}%, ${numOf(p.y, 0)}%) scale(${numOf(p.scale, 1)})`, opacity: numOf(p.opacity, 1) }}>
      {children}
    </AbsoluteFill>
  );
};

// Brand mark for faceless talking beats — configurable size/position, agent-tweenable.
export const Logo: React.FC<{ src: string; sizePx: number; x: number; y: number; keyframes: BgKeyframe[]; fromSec: number }> = ({
  src,
  sizePx,
  x,
  y,
  keyframes,
  fromSec,
}) => (
  <AnimatedElement x={x} y={y} keyframes={keyframes} fromSec={fromSec} defaultEntrance>
    <Img src={src} style={{ width: sizePx }} />
  </AnimatedElement>
);

// Word-synced caption: the spoken words, revealed + highlighted in time with the VO.
// Typewriter reveal (pop/bounce) per word at its start; active word highlighted; emphasised
// words glow. Driven by absolute word timings, so it's frame-deterministic.
export const WordCaption: React.FC<{
  words: WordTiming[];
  emphasis?: string[];
  startSec: number;
  t: Theme;
  backplate?: { bg: string } | null;
  styleName?: CaptionStyle;
  anim?: CaptionAnimation;
  reveal?: CaptionReveal; // "word" = per-word pop (default); "all" = whole line laid out, highlight tracks the VO
  // "lower" = the lower-third band (default; app cut-ins + on-camera avatar beats). "center" =
  // optical-centre hero placement at a larger size — used on faceless talking beats so the text
  // IS the frame instead of a lone line stranded under an empty top two-thirds.
  placement?: "lower" | "center";
}> = ({ words, emphasis = [], startSec, t, backplate, styleName = "stroke", anim, reveal = "word", placement = "lower" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tAbs = startSec + frame / fps;
  const active = activeWordIndex(words, tAbs);
  const emph = new Set(emphasis.map(normWord));
  const center = placement === "center";
  const groupIn = spring({ frame, fps, config: { damping: 200, mass: 0.6 } }); // whole-caption fade for reveal="all"
  const sizeMul = center ? 1.42 : 0.92; // hero scale centred; legacy 0.92 in the lower band
  const row = (
    <div
      style={{
        // words mode boxes each word individually, so only the legacy backplate applies to the row.
        // Spread its plate first, then re-assert display:flex — lineBoxStyle's display:inline-block would
        // otherwise clobber this row's flex layout and collapse the columnGap that spaces the words.
        ...lineBoxStyle("stroke", t, backplate?.bg),
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        columnGap: center ? 22 : 18,
        rowGap: center ? 8 : 4,
        maxWidth: "100%",
      }}
    >
      {words.map((w, i) => {
        // revealFrame = frames since this word started (negative until it's spoken). Spring damping
        // 12 / mass 0.6 = a brisk per-word pop.
        const revealFrame = (tAbs - w.start) * fps;
        const s = spring({ frame: revealFrame, fps, config: { damping: 12, mass: 0.6 } });
        const isActive = i === active;
        const isEmph = emph.has(normWord(w.word));
        // Single accent: the spoken word and the brand name take the style's highlight treatment.
        const isHi = isHighlightWord(w.word, { isActive, brandName: t.brandName });
        const ink = wordStyle(styleName, t, { highlight: isHi, emph: isActive && isEmph });
        let transform: string;
        let opacity: number;
        let filter: string | undefined;
        if (reveal === "all") {
          // reveal="all": the whole caption is laid out and faded in together (no per-word entrance),
          // so a long line can't strand its first word at a wrapped corner during a VO pause. The
          // active word still highlights (via ink) and bumps 1.1x as the VO reaches it.
          transform = `scale(${isActive ? 1.1 : 1})`;
          opacity = groupIn;
          filter = composeFilters(ink.filter as string | undefined);
        } else if (!anim || anim === "pop") {
          // Native pop — exact legacy math: 0.6→1 grow-in, active word bumped 1.1x, unspoken hidden.
          const scale = (revealFrame <= 0 ? 0.6 : interpolate(s, [0, 1], [0.6, 1])) * (isActive ? 1.1 : 1);
          transform = `scale(${scale})`;
          opacity = revealFrame <= 0 ? 0 : interpolate(s, [0, 1], [0, 1]);
          filter = composeFilters(ink.filter as string | undefined);
        } else {
          const a = animatePreset(anim, { s, frame: revealFrame, index: i });
          // "none" is invalid inside a transform function list (Chromium drops the whole transform),
          // so substitute identity when the preset has no transform of its own.
          const baseT = a.transform === "none" ? "" : a.transform;
          transform = `${baseT} scale(${isActive ? 1.1 : 1})`.trim().replace(/\s+/g, " ");
          opacity = a.opacity;
          filter = composeFilters(ink.filter as string | undefined, a.filter);
        }
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              fontFamily: t.font,
              fontSize: Math.round(t.captionFontSize * sizeMul),
              lineHeight: 1.05,
              letterSpacing: center ? "-0.01em" : undefined,
              ...ink,
              transform,
              opacity,
              filter,
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
  if (center) {
    return <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: "0 72px" }}>{row}</AbsoluteFill>;
  }
  return (
    <div style={{ position: "absolute", left: 56, right: 56, bottom: CAPTION_BOTTOM, display: "flex", justifyContent: "center" }}>{row}</div>
  );
};

export const Kicker: React.FC<{ text: string; color: string; fg: string; t: Theme }> = ({ text, color, fg, t }) => {
  const f = useCurrentFrame();
  // damping 180 = heavily damped (no overshoot) → a clean fade-in (drives opacity only). top 150 = px
  // from the frame top where the kicker pill sits.
  const s = spring({ frame: f, fps: 30, config: { damping: 180 } });
  return (
    <div style={{ position: "absolute", top: 150, left: 0, right: 0, display: "flex", justifyContent: "center", opacity: s }}>
      <span style={{ background: color, color: fg, fontFamily: t.font, fontWeight: 900, fontSize: 36, padding: "13px 24px", borderRadius: 999 }}>
        {text}
      </span>
    </div>
  );
};

export const AppCutaway: React.FC<{
  asset: string;
  dur: number;
  t: Theme;
  shot?: Shot;
  transition?: Transition;
  holdExit?: boolean; // next beat is also media — hold at full opacity, the successor fades in on top
}> = ({ asset, dur, t, shot = "static", transition = "fade", holdExit = false }) => {
  const f = useCurrentFrame();
  const p = Math.min(1, f / dur);

  // --- camera move (inner image) --- (pure math in motion.ts; includes scroll/scroll-up)
  const { scale, tx, ty } = shotTransform(shot, p);

  // --- transition (outer layer), CapCut-style: spring "fly in" + settle, eased fade-out exit ---
  // ein = entrance spring over ~18 frames (damping 14 / stiffness 130 / mass 0.6 → fast settle with a
  // small overshoot). eout = exit ramp 0→1 over the last 12 frames, cubic-eased. Every animated exit
  // fades opacity out — motion without a fade snaps to the background and reads as a glitch.
  const { fps } = useVideoConfig();
  const ein = spring({ frame: f, fps, config: { damping: 14, stiffness: 130, mass: 0.6 }, durationInFrames: 18 });
  const eIO = Math.min(1, ein); // clamped (no overshoot) for opacity/scale
  const eout = holdExit
    ? 0
    : Easing.in(Easing.cubic)(
        interpolate(f, [dur - 12, dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      );
  let opacity = 1;
  let otx = 0;
  let oty = 0;
  let oscale = 1;
  if (transition === "fly-left") {
    // 120 = entry offset (% of frame) it flies in from; -60 = exit drift while fading off left.
    otx = (1 - ein) * 120 + eout * -60; // springs in from the right (slight overshoot), fades off left
    oscale = lerp(1.12, 1.0, eIO); // oversize 12% during entry so the slide never reveals an edge
    opacity = 1 - eout;
  } else if (transition === "fly-up") {
    oty = (1 - ein) * 120 + eout * -60;
    oscale = lerp(1.12, 1.0, eIO);
    opacity = 1 - eout;
  } else if (transition === "pop") {
    // Scale 0.72→1 on entry (28% punch-up), shrink 12% on exit. opacity fades in over the first half
    // of the spring (ein*2 clamped) and out with eout.
    oscale = (0.72 + 0.28 * ein) * (1 - 0.12 * eout); // zoom-punch in (spring overshoot), shrink out
    opacity = Math.min(1, ein * 2) * (1 - eout);
  } else if (transition === "fade") {
    opacity = eIO * (1 - eout);
  } else if (transition === "dissolve") {
    // Filmic crossfade for footage: no spring, no bounce — a 24-frame eased fade-in with a slow
    // 1.05→1 scale settle, and a matching fade-out that drifts gently forward (1→1.03).
    const din = Easing.out(Easing.cubic)(
      interpolate(f, [0, 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    );
    opacity = din * (1 - eout);
    oscale = lerp(1.05, 1.0, din) * (1 + 0.03 * eout);
  }
  // "cut": no entrance/exit animation

  const isVideo = asset.toLowerCase().endsWith(".mp4") || asset.toLowerCase().endsWith(".mov");
  return (
    <AbsoluteFill style={{ backgroundColor: t.night, opacity, transform: `translate(${otx}%, ${oty}%) scale(${oscale})` }}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", overflow: "hidden" }}>
        {isVideo ? (
          <OffthreadVideo src={staticFile(asset)} style={{ width: 1080, transform: `translate(${tx}%, ${ty}%) scale(${scale})` }} />
        ) : (
          <Img src={staticFile(asset)} style={{ width: 1080, transform: `translate(${tx}%, ${ty}%) scale(${scale})` }} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// Cinematic finishing pass — the single layer that unifies footage, backgrounds and the avatar into
// one graded "film" instead of flat composited layers. Two deterministic effects, both adaptive to
// the base luminance so a light paper brand reads as printed stock and a dark neon brand reads as
// film — neither ever glows (kino brand rule):
//   • vignette  — a soft edge falloff that adds depth and pulls the eye to centre.
//   • grain     — a single fixed-seed fractal-noise tile TRANSLATED on an 8-frame cycle, so it
//                 shimmers like real emulsion without strobing. Crucially the (expensive) noise
//                 rasterises ONCE — only a cheap transform changes per frame — so full video encodes
//                 stay fast, and it's frame-deterministic (offset is a pure fn of frame → cache-safe,
//                 identical across Remotion's parallel workers). Painted at half res for coarser,
//                 more filmic grain at ~4x less cost.
// Mounted ABOVE the photographic layers (backdrop/avatar/app) but BELOW the motion-graphic beats,
// captions, logo and disclosure. Motion graphics own their finish via the opt-in .kino-grain /
// .kino-vignette utilities (motiongraphic.ts), so this global pass must not impose grain on them.
export const FilmFinish: React.FC<{ t: Theme }> = ({ t }) => {
  const f = useCurrentFrame();
  const light = luminance(t.night) > 0.5;
  // Per-frame jitter from a fixed 8-step cycle (≤7px) — grain shimmer with no noise recompute.
  const OX = [0, -6, 5, -3, 7, -5, 3, -7];
  const OY = [0, 5, -7, 4, -5, 7, -4, 6];
  const dx = OX[f % 8];
  const dy = OY[f % 8];
  const grainOpacity = light ? 0.05 : 0.09;
  const vignette = light
    ? "radial-gradient(ellipse 88% 76% at 50% 45%, rgba(0,0,0,0) 55%, rgba(28,20,12,0.18) 100%)"
    : "radial-gradient(ellipse 92% 80% at 50% 45%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.46) 100%)";
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: vignette }} />
      <AbsoluteFill style={{ opacity: grainOpacity, mixBlendMode: light ? "multiply" : "soft-light", overflow: "hidden" }}>
        <svg
          width="540"
          height="960"
          preserveAspectRatio="none"
          style={{ position: "absolute", top: -16, left: -16, width: "calc(100% + 32px)", height: "calc(100% + 32px)", transform: `translate(${dx}px, ${dy}px)` }}
        >
          <filter id="kino-film-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={7} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="540" height="960" filter="url(#kino-film-grain)" />
        </svg>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const Disclosure: React.FC<{ text: string; t: Theme }> = ({ text, t }) => (
  <div
    style={{
      position: "absolute",
      bottom: 30,
      left: 0,
      right: 0,
      textAlign: "center",
      color: "rgba(255,255,255,.5)",
      fontFamily: t.font,
      fontWeight: 700,
      fontSize: 21,
      textShadow: "0 2px 6px rgba(0,0,0,.6)",
    }}
  >
    {text}
  </div>
);
