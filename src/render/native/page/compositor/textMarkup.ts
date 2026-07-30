// HTML-string ports of the text layers in components.tsx. The compositor rasterizes these
// through the html provider, so they must produce the same box the React components do.
//
// components.tsx is the parity reference and is NOT edited: read it, port it, compare.
import type { Theme } from "../../../props.js";
import type { ResolvedText } from "../../../textStyles.js";
import { filmFinishParams, luminance } from "../../../filmFinish.js";

/** Spec text reaches the DOM path as React children, which escape by construction. These
 *  markup strings are injected as HTML, so they have to escape explicitly. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

import { CAPTION_BOTTOM } from "../../../captionLayout.js";

export function captionMarkup(opts: {
  text: string;
  words?: Array<{ word: string; start: number; end: number }>;
  tAbs?: number;
  theme: Theme;
  hero: boolean;
  activeWord: number | null;
}): string {
  const { text, words, tAbs, theme, hero, activeWord } = opts;
  const size = hero ? Math.round(theme.captionFontSize * 1.42) : theme.captionFontSize;

  let body: string;
  if (words && words.length && tAbs !== undefined) {
    body = words
      .map((w, i) => {
        const spoken = tAbs >= w.start;
        const opacity = spoken ? 1 : 0;
        const activeClass = i === activeWord ? " kino-word-active" : "";
        return `<span class="kino-word${activeClass}" style="opacity:${opacity}">${escapeHtml(w.word)}</span>`;
      })
      .join(" ");
  } else if (activeWord !== null) {
    body = text
      .split(/\s+/)
      .map((w, i) => `<span class="kino-word${i === activeWord ? " kino-word-active" : ""}">${escapeHtml(w)}</span>`)
      .join(" ");
  } else {
    body = escapeHtml(text);
  }

  if (hero) {
    const heroWords = (words ? words.map(w => w.word) : text.split(/\s+/))
      .map((w, i) => {
        const spoken = words && tAbs !== undefined ? tAbs >= words[i].start : true;
        const opacity = spoken ? 1 : 0;
        const activeClass = i === activeWord ? " kino-word-active" : "";
        return `<span class="kino-word${activeClass}" style="display:inline-block;opacity:${opacity}">${escapeHtml(w)}</span>`;
      })
      .join("");

    const colGap = words ? 34 : 22;
    const rowGap = words ? 8 : 6;
    return (
      `<style>` +
      `.kino-cap-wrap{position:absolute;inset:0;display:flex;justify-content:center;align-items:center;padding:0 80px}` +
      `.kino-cap-row{display:flex;flex-wrap:wrap;justify-content:center;column-gap:${colGap}px;row-gap:${rowGap}px}` +
      `.kino-word{font-family:'${theme.font}',sans-serif;font-weight:900;font-size:${size}px;line-height:1.04;letter-spacing:-0.015em;` +
      `color:${theme.fg};text-align:center;` +
      `-webkit-text-stroke:${theme.captionStroke}px #000;paint-order:stroke fill;text-shadow:0 8px 28px rgba(0,0,0,.5)}` +
      `.kino-word-active{color:${theme.accent}}` +
      `</style><div class="kino-cap-wrap"><div class="kino-cap-row">${heroWords}</div></div>`
    );
  }

  return (
    `<style>` +
    `.kino-cap-wrap{position:absolute;left:48px;right:48px;bottom:${CAPTION_BOTTOM}px;display:flex;justify-content:center}` +
    `.kino-cap{font-family:'${theme.font}',sans-serif;font-weight:900;font-size:${size}px;line-height:1.03;letter-spacing:-0.01em;` +
    `color:${theme.fg};text-align:center;` +
    `-webkit-text-stroke:${theme.captionStroke}px #000;paint-order:stroke fill;text-shadow:0 6px 20px rgba(0,0,0,.45)}` +
    `.kino-word-active{color:${theme.accent}}` +
    `</style><div class="kino-cap-wrap"><span class="kino-cap">${body}</span></div>`
  );
}

export function kickerMarkup(opts: {
  text: string;
  color: string;
  fg: string;
  theme: Theme;
}): string {
  const { text, color, fg, theme } = opts;
  return (
    `<style>` +
    `.kino-kicker-wrap{position:absolute;top:150px;left:0;right:0;display:flex;justify-content:center}` +
    `.kino-kicker{background:${color};color:${fg};font-family:'${theme.font}',sans-serif;font-weight:900;font-size:36px;padding:13px 24px;border-radius:999px}` +
    `</style><div class="kino-kicker-wrap"><span class="kino-kicker">${escapeHtml(text)}</span></div>`
  );
}

export function textMarkup(opts: {
  overlay: ResolvedText;
  theme: Theme;
}): string {
  const { overlay, theme } = opts;
  return (
    `<style>` +
    `.kino-overlay-wrap{position:absolute;left:${overlay.x}%;top:${overlay.y}%;transform:translate(-50%,-50%);max-width:86%;display:flex;justify-content:center}` +
    `.kino-overlay{font-family:'${theme.font}',sans-serif;font-size:${overlay.sizePx}px;text-align:center;line-height:1.05;white-space:pre-line;color:${theme.fg};font-weight:900}` +
    `</style><div class="kino-overlay-wrap"><span class="kino-overlay">${escapeHtml(overlay.text)}</span></div>`
  );
}

export function disclosureMarkup(opts: {
  text: string;
  theme: Theme;
}): string {
  const { text, theme } = opts;
  return (
    `<style>` +
    `.kino-disc{position:absolute;bottom:30px;left:0;right:0;text-align:center;color:rgba(255,255,255,.5);font-family:'${theme.font}',sans-serif;font-weight:700;font-size:21px;text-shadow:0 2px 6px rgba(0,0,0,.6)}` +
    `</style><div class="kino-disc">${escapeHtml(text)}</div>`
  );
}

export function filmMarkup(opts: {
  theme: Theme;
  frame: number;
}): string {
  const { theme, frame } = opts;
  const { vignette, grainOpacity } = filmFinishParams(theme.bg, theme.film);
  const OX = [0, -6, 5, -3, 7, -5, 3, -7];
  const OY = [0, 5, -7, 4, -5, 7, -4, 6];
  const dx = OX[frame % 8];
  const dy = OY[frame % 8];
  const light = luminance(theme.bg) > 0.5;
  const blend = light ? "multiply" : "soft-light";

  return (
    `<style>` +
    `.kino-film-vig{position:absolute;inset:0;background:${vignette}}` +
    `.kino-film-grain{position:absolute;inset:0;opacity:${grainOpacity};mix-blend-mode:${blend};overflow:hidden}` +
    `</style>` +
    `<div class="kino-film-vig"></div>` +
    `<div class="kino-film-grain">` +
    `<svg width="540" height="960" preserveAspectRatio="none" style="position:absolute;top:-16px;left:-16px;width:calc(100% + 32px);height:calc(100% + 32px);transform:translate(${dx}px,${dy}px)">` +
    `<filter id="kino-film-grain" x="0" y="0" width="100%" height="100%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>` +
    `<feColorMatrix type="saturate" values="0"/>` +
    `</filter>` +
    `<rect width="540" height="960" filter="url(#kino-film-grain)"/>` +
    `</svg></div>`
  );
}
