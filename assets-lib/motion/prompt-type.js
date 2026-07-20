// Typed prompt / chat window (Tier 2). Burst-types env.words into the field while a
// TIME-driven camera pushes in. Extracted from the kino advert (prompt beat).
//
// Customize: MARK (chrome label). VO text in the spec becomes the typed string.
// Copy into projects/<name>/assets/motion/ and: "source": "motion/prompt-type.js"
// See speech-synced-ui skill + docs/motion-graphics.md → Typed-in-sync text.
var MARK = "app";

function WIN(fieldHtml, caretOn, camStyle, extraHtml) {
  var caret = '<b class="crt" style="opacity:' + (caretOn ? 1 : 0) + '">█</b>';
  return ''
  + '<div class="bg"></div>'
  + '<div class="cam" style="transform:' + camStyle + '">'
  +   '<div class="win">'
  +     '<div class="bar"><span class="mark">' + MARK + '</span><span class="dot"></span></div>'
  +     (extraHtml || '')
  +     '<div class="field"><span class="txt">' + fieldHtml + caret + '</span>'
  +       '<span class="send">↑</span></div>'
  +   '</div>'
  + '</div>'
  + '<div class="kino-grain"></div><div class="kino-vignette"></div>'
  + '<style>'
  + '.bg{position:absolute;inset:0;background:'
  +   'radial-gradient(130% 90% at 50% 118%, color-mix(in srgb, var(--kino-mint) 20%, transparent), transparent 58%),'
  +   'radial-gradient(110% 75% at 22% -12%, color-mix(in srgb, var(--kino-gold) 12%, transparent), transparent 55%),'
  +   'var(--kino-night)}'
  + '.cam{position:absolute;inset:0;transform-origin:50% 62%}'
  + '.win{position:absolute;left:9%;right:9%;top:24%;bottom:24%;border-radius:3vw;'
  +   'background:color-mix(in srgb, var(--kino-night) 85%, #000);border:0.18vw solid var(--kino-mint);'
  +   'box-shadow:0 0 6vw color-mix(in srgb, var(--kino-mint) 28%, transparent),'
  +   ' inset 0 0 4vw color-mix(in srgb, var(--kino-mint) 6%, transparent)}'
  + '.bar{position:absolute;left:5%;top:5%;display:flex;align-items:center;gap:1vw}'
  + '.mark{font-family:var(--kino-font);color:var(--kino-white);font-weight:800;font-size:3.4vw}'
  + '.dot{width:1.1vw;height:1.1vw;border-radius:50%;background:var(--kino-gold)}'
  + '.field{position:absolute;left:6%;right:6%;bottom:7%;min-height:8vw;border-radius:2vw;'
  +   'background:color-mix(in srgb, var(--kino-mint) 6%, transparent);'
  +   'border:0.12vw solid color-mix(in srgb, var(--kino-mint) 35%, transparent);'
  +   'display:flex;align-items:center;padding:1.6vw 2.4vw}'
  + '.txt{font-family:var(--kino-label-font);color:var(--kino-white);font-size:2.9vw;'
  +   'white-space:pre-wrap;line-height:1.25;flex:1}'
  + '.crt{color:var(--kino-mint);margin-left:.3vw}'
  + '.send{width:5vw;height:5vw;border-radius:50%;'
  +   'background:color-mix(in srgb, var(--kino-mint) 12%, transparent);'
  +   'color:var(--kino-mint);display:flex;align-items:center;justify-content:center;font-size:3vw}'
  + '</style>';
}

var KEY = 0.045, words = env.words || [], out = "", typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t <= w.start) break;
  var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
  out += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
  typing = n < w.word.length;
}
var caretOn = typing || env.frame < 5 || Math.floor(env.frame / 15) % 2 === 0;
var pin = env.progress;
var ease = 1 - (1 - pin) * (1 - pin);
var S = 1 + 0.22 * ease;
var panY = -3.5 * ease;
var panX = 1.2 * Math.sin(pin * Math.PI);
var cam = "translate(" + panX.toFixed(2) + "vw," + panY.toFixed(2) + "vw) scale(" + S.toFixed(4) + ")";
return WIN(out, caretOn, cam, "");
