import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile } from "remotion";
import { AppCutaway, Caption, Disclosure, Kicker } from "./components";
import type { KinoProps } from "../props";

export const KinoVideo: React.FC<KinoProps> = ({ theme, fps, avatar, disclosure, segments }) => {
  const f = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: theme.night }}>
      {avatar ? (
        <OffthreadVideo src={staticFile(avatar)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <AbsoluteFill style={{ backgroundColor: theme.night }} />
      )}
      {segments
        .filter((s) => s.kind === "app")
        .map((s, i) => (
          <Sequence key={`a${i}`} from={f(s.startSec)} durationInFrames={f(s.endSec) - f(s.startSec)}>
            <AppCutaway asset={s.asset!} dur={f(s.endSec) - f(s.startSec)} t={theme} />
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
