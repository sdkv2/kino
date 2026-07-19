#!/usr/bin/env python3
"""Emit the three kino-window motion graphics from one shared chrome definition."""
import pathlib

HERE = pathlib.Path(__file__).parent

# Shared JS prelude: WIN(fieldHtml, caretOn, camStyle, ctaHtml) -> full window HTML.
# Static grain/vignette (frame-independent) => loop-safe. No banned tokens.
SHARED = r"""
function WIN(fieldHtml, caretOn, camStyle, ctaHtml) {
  var caret = '<b class="crt" style="opacity:' + (caretOn ? 1 : 0) + '">█</b>';
  return ''
  + '<div class="bg"></div>'
  + '<div class="cam" style="transform:' + camStyle + '">'
  +   '<div class="win">'
  +     '<div class="bar"><span class="mark">kino</span><span class="dot"></span></div>'
  +     (ctaHtml || '')
  +     '<div class="field"><span class="txt">' + fieldHtml + caret + '</span>'
  +       '<span class="send">↑</span></div>'
  +   '</div>'
  + '</div>'
  + '<div class="kino-grain"></div><div class="kino-vignette"></div>'
  + '<style>'
  + '.bg{position:absolute;inset:0;background:'
  +   'radial-gradient(130% 90% at 50% 118%, rgba(128,226,180,.20), rgba(128,226,180,0) 58%),'
  +   'radial-gradient(110% 75% at 22% -12%, rgba(217,154,32,.12), rgba(217,154,32,0) 55%),'
  +   '#0b1020}'
  + '.cam{position:absolute;inset:0;transform-origin:50% 62%}'
  + '.win{position:absolute;left:9%;right:9%;top:24%;bottom:24%;border-radius:3vw;'
  +   'background:rgba(9,14,28,.72);border:0.18vw solid var(--kino-mint);'
  +   'box-shadow:0 0 6vw rgba(128,226,180,.28), inset 0 0 4vw rgba(128,226,180,.06)}'
  + '.bar{position:absolute;left:5%;top:5%;display:flex;align-items:center;gap:1vw}'
  + '.mark{font-family:var(--kino-font);color:var(--kino-white);font-weight:800;font-size:3.4vw}'
  + '.dot{width:1.1vw;height:1.1vw;border-radius:50%;background:var(--kino-gold)}'
  + '.field{position:absolute;left:6%;right:6%;bottom:8%;height:8vw;border-radius:2vw;'
  +   'background:rgba(128,226,180,.06);border:0.12vw solid rgba(128,226,180,.35);'
  +   'display:flex;align-items:center;padding:0 3vw}'
  + '.txt{font-family:var(--kino-label-font);color:var(--kino-white);font-size:3.4vw;'
  +   'white-space:pre;flex:1}'
  + '.crt{color:var(--kino-mint);margin-left:.3vw}'
  + '.send{width:5vw;height:5vw;border-radius:50%;background:rgba(128,226,180,.12);'
  +   'color:var(--kino-mint);display:flex;align-items:center;justify-content:center;font-size:3vw}'
  + '</style>';
}
"""

# --- beat 0: type env.words, camera push-in; settled window at t=0 (no pop) ---
PROMPT = SHARED + r"""
var KEY = 0.045, words = env.words || [], out = "", typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t <= w.start) break; // strictly-past-start => t=0 (word 0 starts at 0) renders fully empty
  var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
  out += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
  typing = n < w.word.length;
}
// caret: solid while typing; solid for the first 5 frames (loop seam); else blink
var caretOn = typing || env.frame < 5 || Math.floor(env.frame / 15) % 2 === 0;
// camera: native at t=0, ease-out push-in across the whole beat off env.progress (off TIME, not
// typed count) so it reaches the S=1.14 handoff scale THINKING starts from regardless of the
// beat's actual VO duration, while still settling most of the way early (ease-out).
var pin = env.progress;
var S = 1 + 0.14 * (1 - (1 - pin) * (1 - pin));
var cam = "scale(" + S.toFixed(4) + ")";
return WIN(out, caretOn, cam, "");
"""

# --- beat 1: prompt already there; PULL BACK to native; thinking dots pulse ---
THINKING = SHARED + r"""
var full = "Kino, make me an advert";
// start zoomed (match beat-0 end S=1.14), pull back to native across the beat
var S = 1.14 - 0.14 * (env.progress * (2 - env.progress));
var cam = "scale(" + S.toFixed(4) + ")";
// three thinking dots pulsing off --t (continuous life), offset per dot
function dot(k){
  var a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(env.t * 6 - k));
  return '<span style="width:1.4vw;height:1.4vw;border-radius:50%;background:var(--kino-mint);'
    + 'display:inline-block;margin:0 .6vw;opacity:' + a.toFixed(3) + '"></span>';
}
var dots = '<div style="margin-left:.6vw;display:inline-flex;align-items:center">'
  + dot(0) + dot(1) + dot(2) + '</div>';
var caretOn = false; // dots carry the life here
return WIN(full + '', caretOn, cam, '') .replace('<span class="send">', dots + '<span class="send">');
"""

# --- beat 5: CTA lockup, then settle to the EMPTY ready-state == beat-0 frame 0 ---
CLOSE = SHARED + r"""
// first ~70% shows the CTA lockup fading in; last ~25% clears to the empty ready-state.
// clear must reach 1 (showFull=false) at the SAME 0.95 progress used by the caret guard below —
// progress = frame/durationFrames maxes out at (durationFrames-1)/durationFrames, just under 1,
// so a window ending at progress 1.0 would never fully resolve and the seam would never converge.
var fade = Math.min(1, env.progress / 0.6);                          // lockup in
var clear = Math.min(1, Math.max(0, (env.progress - 0.7) / 0.25));   // lockup out + field empties by 0.95
var showFull = clear < 1;
var field = showFull ? "Kino, make me an advert" : "";
// caret solid for the final stretch (loop seam — matches beat-0's t=0 solid caret);
// no env.duration field exists, so gate off env.progress instead of a frame count
var caretOn = env.progress > 0.95 || Math.floor(env.frame / 15) % 2 === 0;
var camS = 1.0; // native scale at the seam
var cta = '<div class="cta" style="opacity:' + (fade * (1 - clear)).toFixed(3) + '">'
  + '<div class="wm">kino</div>'
  + '<div class="pill">tell your agent</div></div>'
  + '<style>.cta{position:absolute;left:0;right:0;top:34%;text-align:center}'
  + '.wm{font-family:var(--kino-font);color:var(--kino-white);font-weight:800;font-size:9vw;'
  +   'text-shadow:0 0 5vw rgba(128,226,180,.5),0 0 8vw rgba(217,154,32,.35)}'
  + '.pill{display:inline-block;margin-top:2vw;padding:1.4vw 3.2vw;border-radius:5vw;'
  +   'background:var(--kino-gold);color:var(--kino-night);font-family:var(--kino-label-font);font-size:2.6vw}'
  + '</style>';
// when cleared, drop the CTA entirely so the final frame == empty prompt window
return WIN(field, caretOn, "scale(" + camS.toFixed(3) + ")", showFull ? cta : "");
"""

for name, body in [("prompt-window.js", PROMPT),
                   ("thinking-window.js", THINKING),
                   ("close-window.js", CLOSE)]:
    (HERE / name).write_text(body.strip() + "\n")
    print("wrote", name)
