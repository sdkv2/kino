import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { AppCutaway, Caption, Disclosure, Kicker } from "./components";
import type { KinoProps } from "../props";
import type { Shot, Transition } from "../motion";

export const KinoVideo: React.FC<KinoProps> = ({ theme, fps, avatar, disclosure, segments }) => {
  const f = (s: number) => Math.round(s * fps);
  const frame = useCurrentFrame();
  const totalFrames = Math.round(Math.max(...segments.map((s) => s.endSec), 1) * fps);
  // subtle continuous push-in on the avatar base so talking-head shots breathe
  const avScale = interpolate(frame, [0, totalFrames], [1.0, 1.08], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: theme.night }}>
      {avatar ? (
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <OffthreadVideo
            src={staticFile(avatar)}
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${avScale})` }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundColor: theme.night }} />
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
      {segments.map((s, i) => (
        <Sequence key={`c${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
          <Caption text={s.caption} t={theme} />
        </Sequence>
      ))}
      <Disclosure text={disclosure} t={theme} />
    </AbsoluteFill>
  );
};
