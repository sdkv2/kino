function WIN(fieldHtml, caretOn, camStyle, ctaHtml) {
  var caret = '<b class="crt" style="opacity:' + (caretOn ? 1 : 0) + '">█</b>';
  return ''
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
