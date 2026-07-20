// Loop seam: empty prompt window that settles to the ready-state (Tier 2).
// Last frame matches prompt-type.js at t=0 (empty field, native scale, solid caret)
// so an mp4 can loop. Extracted from the kino advert (loop-settle beat).
//
// Customize: MARK. Pair as the final beat after build-pipeline.
// Copy into projects/<name>/assets/motion/ and: "source": "motion/loop-ready.js"
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

var p = env.progress;
var settle = p * (2 - p);
var S = 1.08 - 0.08 * settle;
var panY = -1.5 * (1 - settle);
var doneA = Math.max(0, 1 - p / 0.55);
var caretOn = env.progress > 0.95 || Math.floor(env.frame / 15) % 2 === 0;
var done = doneA > 0.01
  ? ('<div class="done" style="opacity:' + doneA.toFixed(3) + '">✓</div>'
    + '<style>.done{position:absolute;left:0;right:0;top:38%;text-align:center;'
    + 'font-family:var(--kino-font);color:var(--kino-mint);font-size:14vw;'
    + 'text-shadow:0 0 4vw color-mix(in srgb, var(--kino-mint) 45%, transparent)}</style>')
  : '';
var cam = "translateY(" + panY.toFixed(2) + "vw) scale(" + S.toFixed(4) + ")";
return WIN("", caretOn, cam, done);
