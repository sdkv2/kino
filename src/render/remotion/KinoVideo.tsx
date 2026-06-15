import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { AppCutaway, Caption, Disclosure, FacelessBackdrop, HeroCaption, Kicker, Logo } from "./components";
import type { KinoProps } from "../props";
import type { Shot, Transition } from "../motion";

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

export const KinoVideo: React.FC<KinoProps> = ({ theme, fps, avatar, avatarWindows, voTrack, logo, facelessBg, disclosure, segments }) => {
  const f = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.night }}>
      {/* Continuous voiceover — covers every segment, including the app cut-ins where the avatar is trimmed out. */}
      {voTrack ? <Audio src={staticFile(voTrack)} /> : null}

      {/* Base layer: avatar windows when on camera, else a living backdrop so faceless beats aren't empty. */}
      {avatar ? (
        avatarWindows.map((w, i) => {
          const dur = f(w.toSec) - f(w.fromSec);
          return (
            <Sequence key={`av${i}`} from={f(w.fromSec)} durationInFrames={dur}>
              <AvatarClip src={staticFile(avatar)} trimFrames={f(w.audioStartSec)} durFrames={dur} />
            </Sequence>
          );
        })
      ) : (
        <FacelessBackdrop t={theme} bg={facelessBg ? staticFile(facelessBg) : null} />
      )}

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
            {s.kicker ? <Kicker text={s.kicker.text} color={s.kicker.color} fg={s.kicker.fg} t={theme} /> : null}
          </Sequence>
        ))}

      {/* Brand mark on faceless talking beats (top-center, above the hero text). */}
      {!avatar && logo
        ? segments.map((s, i) =>
            s.kind === "avatar" ? (
              <Sequence key={`lg${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
                <Logo src={staticFile(logo)} />
              </Sequence>
            ) : null,
          )
        : null}

      {segments.map((s, i) => {
        // Faceless talking beats become full-frame hero text; app beats keep the lower-third caption.
        const hero = !avatar && s.kind === "avatar";
        return (
          <Sequence key={`c${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
            {hero ? <HeroCaption text={s.caption} t={theme} /> : <Caption text={s.caption} t={theme} />}
          </Sequence>
        );
      })}
      <Disclosure text={disclosure} t={theme} />
    </AbsoluteFill>
  );
};
