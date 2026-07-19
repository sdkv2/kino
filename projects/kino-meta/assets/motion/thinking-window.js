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
