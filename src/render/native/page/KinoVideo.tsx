// Native-engine port of the top-level composition. Layers render back-to-front exactly as the
// legacy composition documents:
//   1. night backdrop fill   2. faceless brand backdrop   3. avatar video windows
//   4. app cut-ins (each with its own kicker overlay)     5. full-screen motion-graphic beats
//   6. motion-graphic overlays   7. standalone text overlays (spec `texts[]`)
//   8. logo (faceless beats only)   9. captions (word/hero/lower-third)   10. AI disclosure
// Audio (VO, SFX, ducked music) is mixed node-side by the engine (../audioMix.ts) — nothing to
// mount here. Fonts load once at page boot (index.tsx). `f` converts seconds→frames (sec * fps).
import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from "./runtime";
import { FrameVideo } from "./media";
import { AppCutaway, Caption, Disclosure, FacelessBackdrop, FilmFinish, HeroCaption, Kicker, Logo, TextOverlay, TweenOverlay, WordCaption } from "./components";
import { MotionGraphic } from "./MotionGraphic";
import { PlatformGuide } from "./PlatformGuide";
import { captionBandBottom, hasCaptionContent, isHeroCaption } from "../../captionLayout.js";
import type { KinoProps } from "../../props.js";
import { MOTION_XFADE_FRAMES, motionHandoff, type Shot, type Transition } from "../../motion.js";

// One placement of the (trimmed) avatar clip, with a gentle push-in so the shot breathes. The trim
// offset is baked into the pre-extracted frame set (files[0] = source frame trimFrames).
const AvatarClip: React.FC<{ mediaKey: string; durFrames: number }> = ({ mediaKey, durFrames }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, durFrames], [1.0, 1.08], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <FrameVideo mediaKey={mediaKey} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }} />
    </AbsoluteFill>
  );
};

/** Dissolve in over the motion→motion overlap. First motion beat stays opaque (loop seam). */
const MotionFadeIn: React.FC<{ fadeIn: boolean; children: React.ReactNode }> = ({ fadeIn, children }) => {
  const frame = useCurrentFrame();
  const opacity = fadeIn
    ? interpolate(frame, [0, MOTION_XFADE_FRAMES], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.out(Easing.cubic),
      })
    : 1;
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const KinoVideo: React.FC<KinoProps> = ({ theme, fps, avatar, avatarWindows, logo, background, disclosure, segments, platformGuide }) => {
  const f = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.night }}>
      {/* Living brand backdrop, always the base layer: faceless beats aren't empty, and app cut-in
          transitions reveal the brand background instead of raw black (the avatar covers it on camera). */}
      <FacelessBackdrop t={theme} background={background} />

      {/* Avatar windows on top of the backdrop during on-camera runs. */}
      {avatar
        ? avatarWindows.map((w, i) => {
            const dur = f(w.toSec) - f(w.fromSec);
            return (
              <Sequence key={`av${i}`} from={f(w.fromSec)} durationInFrames={dur}>
                <AvatarClip mediaKey={`av${i}`} durFrames={dur} />
              </Sequence>
            );
          })
        : null}

      {segments.map((s, i) => {
        if (s.kind !== "app") return null;
        // Media-to-media handoff: when the NEXT beat is also an app cut-in, hold this clip (no exit
        // animation) through the VO gap and 12 frames into the successor, which mounts above it and
        // fades in — a crossfade between shots instead of a flash of bare background between them.
        const next = segments[i + 1];
        const chained = next?.kind === "app";
        const beatDur = f(s.endSec) - f(s.startSec);
        const seqDur = chained ? f(next.startSec) - f(s.startSec) + 12 : beatDur;
        return (
          <Sequence key={`a${i}`} from={f(s.startSec)} durationInFrames={seqDur}>
            <AppCutaway
              asset={s.asset!}
              mediaKey={`seg${i}`}
              dur={seqDur}
              t={theme}
              shot={s.shot as Shot | undefined}
              transition={s.transition as Transition | undefined}
              holdExit={chained}
              clipFrom={s.clipFrom}
              clipTo={s.clipTo}
              speed={s.speed}
              pauseAt={s.pauseAt}
              frame={s.frame}
              zoomKeyframes={s.zoomKeyframes}
            />
            {s.kicker ? (
              // Kicker stays scoped to its own beat — it must not bleed over the next clip.
              <Sequence durationInFrames={beatDur}>
                <TweenOverlay keyframes={s.kickerKeyframes ?? []}>
                  <Kicker text={s.kicker.text} color={s.kicker.color} fg={s.kicker.fg} t={theme} />
                </TweenOverlay>
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}

      {/* Cinematic finishing pass (vignette + grain) — grades the photographic layers above
          (backdrop, avatar, app cut-ins) into one film. Sits BELOW the motion-graphic beats/overlays
          (which own their finish via the opt-in .kino-grain/.kino-vignette utilities) and below the
          text/logo/caption layers, so designed graphics and type stay crisp. */}
      <FilmFinish t={theme} />

      {/* Full-screen motion-graphic beats. Consecutive motion→motion handoffs hold the
          outgoing graphic through the VO gap and dissolve into the next (~0.5s overlap). */}
      {segments.map((s, i) => {
        if (s.kind !== "motion" || !s.motion) return null;
        const next = segments[i + 1];
        const prev = segments[i - 1];
        const { from, seqDur, beatDur, fadeIn } = motionHandoff({
          startSec: s.startSec,
          endSec: s.endSec,
          nextMotionStartSec: next?.kind === "motion" ? next.startSec : null,
          prevIsMotion: prev?.kind === "motion",
          fps,
        });
        return (
          <Sequence key={`m${i}`} from={from} durationInFrames={seqDur}>
            <MotionFadeIn fadeIn={fadeIn}>
              <MotionGraphic data={s.motion} durationFrames={beatDur} t={theme} captionBottom={captionBandBottom(s, !!avatar)} />
            </MotionFadeIn>
          </Sequence>
        );
      })}

      {/* Motion-graphic overlays layered on top of their host beat (avatar or app). */}
      {segments
        .filter((s) => s.motionOverlay)
        .map((s, i) => {
          const dur = f(s.endSec) - f(s.startSec);
          return (
            <Sequence key={`mo${i}`} from={f(s.startSec)} durationInFrames={dur}>
              <MotionGraphic data={s.motionOverlay!} durationFrames={dur} t={theme} captionBottom={captionBandBottom(s, !!avatar)} />
            </Sequence>
          );
        })}

      {/* Standalone stylised text overlays (spec `texts[]`) — above motion overlays, below captions. */}
      {segments.flatMap((s, i) =>
        (s.texts ?? []).map((o, j) => (
          <Sequence key={`tx${i}-${j}`} from={f(o.fromSec)} durationInFrames={Math.max(1, f(o.durSec))}>
            <TextOverlay o={o} t={theme} />
          </Sequence>
        )),
      )}

      {/* Brand mark on faceless talking runs — one per contiguous run so it holds steady as the text changes. */}
      {!avatar && logo
        ? avatarWindows.map((w, i) => (
            <Sequence key={`lg${i}`} from={f(w.fromSec)} durationInFrames={f(w.toSec) - f(w.fromSec)}>
              <Logo src={staticFile(logo.src)} sizePx={logo.sizePx} x={logo.x} y={logo.y} keyframes={logo.keyframes} fromSec={w.fromSec} />
            </Sequence>
          ))
        : null}

      {segments.map((s, i) => {
        // Captions are optional: a beat with no words and no caption text mounts nothing (an empty
        // Caption span would still paint its backplate pill).
        if (!hasCaptionContent(s)) return null;
        // words mode = synced spoken text; else faceless talking beats use hero text, app beats lower-third.
        // Faceless CTA end cards are hero-centered too (isHeroCaption) — not a lower-third subtitle.
        const wordMode = s.captionMode === "words" && s.words && s.words.length > 0;
        const hero = isHeroCaption(s, !!avatar);
        // Backplate behind the lower-third caption (legibility over light app screenshots). appOnly
        // (default) scopes it to app cut-ins; the hero text on faceless beats never gets a plate.
        const cbg = theme.captionBg;
        const backplate =
          cbg && (!cbg.appOnly || s.kind === "app") ? { bg: cbg.bg } : null;
        return (
          <Sequence key={`c${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
            <TweenOverlay keyframes={s.captionKeyframes ?? []}>
              {wordMode ? (
                // Faceless talking beats (hero, including CTA) centre their word caption so the text
                // fills the frame; app cut-ins and on-camera avatar keep the lower-third band.
                <WordCaption words={s.words!} emphasis={s.emphasis} startSec={s.startSec} t={theme} backplate={backplate} styleName={s.captionStyle} anim={s.captionAnimation} reveal={s.captionReveal} placement={hero ? "center" : "lower"} />
              ) : hero ? (
                <HeroCaption text={s.caption} t={theme} styleName={s.captionStyle} anim={s.captionAnimation} />
              ) : (
                <Caption text={s.caption} t={theme} backplate={backplate} styleName={s.captionStyle} anim={s.captionAnimation} />
              )}
            </TweenOverlay>
          </Sequence>
        );
      })}
      {disclosure ? <Disclosure text={disclosure} t={theme} /> : null}
      {platformGuide ? <PlatformGuide kind={platformGuide} /> : null}
    </AbsoluteFill>
  );
};
