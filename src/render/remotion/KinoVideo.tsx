import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { AppCutaway, Caption, Disclosure, FacelessBackdrop, FontLoader, HeroCaption, Kicker, Logo, TweenOverlay, WordCaption } from "./components";
import { MotionGraphic } from "./MotionGraphic";
import { captionBandBottom } from "../captionLayout";
import type { KinoProps } from "../props";
import type { Shot, Transition } from "../motion";

// Top-level Remotion composition. Layers render back-to-front in this order:
//   1. night backdrop fill   2. faceless brand backdrop   3. avatar video windows
//   4. app cut-ins (each with its own kicker overlay)     5. full-screen motion-graphic beats
//   6. motion-graphic overlays   7. logo (faceless beats only)   8. captions (word/hero/lower-third)
//   9. AI disclosure
// (Audio and FontLoader sit at the top but paint nothing.) Anything added must be slotted into this
// stack deliberately. `f` below converts seconds→frames (sec * fps).

// One placement of the (trimmed) avatar clip, with a gentle push-in so the shot breathes.
const AvatarClip: React.FC<{ src: string; trimFrames: number; durFrames: number }> = ({ src, trimFrames, durFrames }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, durFrames], [1.0, 1.06], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <OffthreadVideo
        src={src}
        muted
        trimBefore={trimFrames}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})` }}
      />
    </AbsoluteFill>
  );
};

export const KinoVideo: React.FC<KinoProps> = ({ theme, fps, avatar, avatarWindows, voTrack, logo, background, disclosure, segments }) => {
  const f = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.night }}>
      <FontLoader url={theme.fontUrl} />
      {/* Continuous voiceover — covers every segment, including the app cut-ins where the avatar is trimmed out. */}
      {voTrack ? <Audio src={staticFile(voTrack)} /> : null}

      {/* Living brand backdrop, always the base layer: faceless beats aren't empty, and app cut-in
          transitions reveal the brand background instead of raw black (the avatar covers it on camera). */}
      <FacelessBackdrop t={theme} background={background} />

      {/* Avatar windows on top of the backdrop during on-camera runs. */}
      {avatar
        ? avatarWindows.map((w, i) => {
            const dur = f(w.toSec) - f(w.fromSec);
            return (
              <Sequence key={`av${i}`} from={f(w.fromSec)} durationInFrames={dur}>
                <AvatarClip src={staticFile(avatar)} trimFrames={f(w.audioStartSec)} durFrames={dur} />
              </Sequence>
            );
          })
        : null}

      {segments
        .filter((s) => s.kind === "app")
        .map((s, i) => (
          <Sequence key={`a${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
            <AppCutaway
              asset={s.asset!}
              dur={f(s.endSec) - f(s.startSec)}
              t={theme}
              shot={s.shot as Shot | undefined}
              transition={s.transition as Transition | undefined}
            />
            {s.kicker ? (
              <TweenOverlay keyframes={s.kickerKeyframes ?? []}>
                <Kicker text={s.kicker.text} color={s.kicker.color} fg={s.kicker.fg} t={theme} />
              </TweenOverlay>
            ) : null}
          </Sequence>
        ))}

      {/* Full-screen motion-graphic beats. */}
      {segments
        .filter((s) => s.kind === "motion" && s.motion)
        .map((s, i) => {
          const dur = f(s.endSec) - f(s.startSec);
          return (
            <Sequence key={`m${i}`} from={f(s.startSec)} durationInFrames={dur}>
              <MotionGraphic data={s.motion!} durationFrames={dur} t={theme} captionBottom={captionBandBottom(s, !!avatar)} />
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

      {/* Brand mark on faceless talking runs — one per contiguous run so it holds steady as the text changes. */}
      {!avatar && logo
        ? avatarWindows.map((w, i) => (
            <Sequence key={`lg${i}`} from={f(w.fromSec)} durationInFrames={f(w.toSec) - f(w.fromSec)}>
              <Logo src={staticFile(logo.src)} sizePx={logo.sizePx} x={logo.x} y={logo.y} keyframes={logo.keyframes} fromSec={w.fromSec} />
            </Sequence>
          ))
        : null}

      {segments.map((s, i) => {
        // words mode = synced spoken text; else faceless talking beats use hero text, app beats lower-third.
        const wordMode = s.captionMode === "words" && s.words && s.words.length > 0;
        const hero = !avatar && s.kind === "avatar";
        // Backplate behind the lower-third caption (legibility over light app screenshots). appOnly
        // (default) scopes it to app cut-ins; the hero text on faceless beats never gets a plate.
        const cbg = theme.captionBg;
        const backplate = cbg && (!cbg.appOnly || s.kind === "app") ? { bg: cbg.bg } : null;
        return (
          <Sequence key={`c${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
            <TweenOverlay keyframes={s.captionKeyframes ?? []}>
              {wordMode ? (
                <WordCaption words={s.words!} emphasis={s.emphasis} startSec={s.startSec} t={theme} backplate={backplate} styleName={s.captionStyle} anim={s.captionAnimation} />
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
    </AbsoluteFill>
  );
};
