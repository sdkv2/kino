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
  + '.field{position:absolute;left:6%;right:6%;bottom:7%;min-height:8vw;border-radius:2vw;'
  +   'background:rgba(128,226,180,.06);border:0.12vw solid rgba(128,226,180,.35);'
  +   'display:flex;align-items:center;padding:1.6vw 2.4vw}'
  + '.txt{font-family:var(--kino-label-font);color:var(--kino-white);font-size:2.9vw;'
  +   'white-space:pre-wrap;line-height:1.25;flex:1}'
  + '.crt{color:var(--kino-mint);margin-left:.3vw}'
  + '.send{width:5vw;height:5vw;border-radius:50%;background:rgba(128,226,180,.12);'
  +   'color:var(--kino-mint);display:flex;align-items:center;justify-content:center;font-size:3vw}'
  + '</style>';
}

var PROMPT = "Kino, make me an advert.";
var KEY = 0.042, words = env.words || [], typed = "", typing = false;
for (var i = 0; i < words.length; i++) {
  var w = words[i];
  if (env.t <= w.start) break;
  var n = Math.min(w.word.length, Math.floor((env.t - w.start) / KEY) + 1);
  typed += w.word.slice(0, n) + (i < words.length - 1 ? " " : "");
  typing = n < w.word.length;
}
// Hold the prompt until the first spoken word, then type the reply over it
var started = words.length && env.t > words[0].start;
var field = started ? typed : PROMPT;
var caretOn = started
  ? (typing || Math.floor(env.frame / 15) % 2 === 0)
  : false;
// Pull back 1.22→1.0 (ease-in-out) + settle pan + soft lateral drift
var p = env.progress;
var pull = p * (2 - p);
var S = 1.22 - 0.22 * pull;
var panY = -3.5 + 3.5 * pull;
var panX = 1.2 * Math.sin((1 - p) * Math.PI) * (1 - pull);
var cam = "translate(" + panX.toFixed(2) + "vw," + panY.toFixed(2) + "vw) scale(" + S.toFixed(4) + ")";
function dot(k){
  var a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(env.t * 6 - k));
  return '<span style="width:1.4vw;height:1.4vw;border-radius:50%;background:var(--kino-mint);'
    + 'display:inline-block;margin:0 .6vw;opacity:' + a.toFixed(3) + '"></span>';
}
var dots = '<div style="margin-left:.6vw;display:inline-flex;align-items:center">'
  + dot(0) + dot(1) + dot(2) + '</div>';
// Dots while holding the prompt; caret takes over once typing starts
var html = WIN(field, caretOn, cam, '');
return started ? html : html.replace('<span class="send">', dots + '<span class="send">');
