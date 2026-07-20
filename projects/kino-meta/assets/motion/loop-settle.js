function TECH_BG() {
  var edge = Math.sin(env.progress * Math.PI);
  var t = env.t;
  var o1x = 18 + edge * 16 * Math.sin(t * 1.4);
  var o1y = -6 + edge * 12 * Math.cos(t * 1.1);
  var o2x = 82 + edge * 14 * Math.cos(t * 1.0);
  var o2y = 108 + edge * 10 * Math.sin(t * 1.5);
  var o3x = 50 + edge * 20 * Math.sin(t * 0.75 + 1);
  var o3y = 42 + edge * 16 * Math.cos(t * 0.9);
  var gridY = 6 + edge * 22;
  var gridA = 0.18 + 0.28 * edge;
  var scanY = 5 + ((t * 32) % 90);
  var scanA = 0.28 * edge;
  var bits = "";
  for (var i = 0; i < 14; i++) {
    var px = 6 + (i * 7.1 + edge * 10 * Math.sin(t * 1.6 + i * 0.7)) % 88;
    var py = 10 + (i * 6.3 + edge * 14 * Math.cos(t * 1.2 + i)) % 80;
    var pa = edge * (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 3.0 + i)));
    var ps = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t + i * 1.3));
    bits += '<div class="bit" style="left:' + px.toFixed(1) + '%;top:' + py.toFixed(1)
      + '%;opacity:' + pa.toFixed(3) + ';width:' + ps.toFixed(2) + 'vw;height:' + ps.toFixed(2) + 'vw"></div>';
  }
  return ''
  + '<div class="bg">'
  +   '<div class="neb n1" style="left:' + o1x.toFixed(1) + '%;top:' + o1y.toFixed(1) + '%"></div>'
  +   '<div class="neb n2" style="left:' + o2x.toFixed(1) + '%;top:' + o2y.toFixed(1) + '%"></div>'
  +   '<div class="neb n3" style="left:' + o3x.toFixed(1) + '%;top:' + o3y.toFixed(1) + '%"></div>'
  +   '<div class="grid" style="opacity:' + gridA.toFixed(3)
  +     ';transform:perspective(90vw) rotateX(62deg) translateY(' + gridY.toFixed(2) + 'vw) scale(1.35)"></div>'
  +   '<div class="hex" style="opacity:' + (0.10 + 0.16 * edge).toFixed(3) + '"></div>'
  +   '<div class="scan" style="top:' + scanY.toFixed(1) + '%;opacity:' + scanA.toFixed(3) + '"></div>'
  +   bits
  +   '<div class="hud tl"></div><div class="hud tr"></div>'
  +   '<div class="hud bl"></div><div class="hud br"></div>'
  + '</div>'
  + '<style>'
  + '.bg{position:absolute;inset:0;overflow:hidden;background:#0b1020}'
  + '.neb{position:absolute;width:70vw;height:70vw;margin:-35vw 0 0 -35vw;border-radius:50%;pointer-events:none;'
  +   'filter:blur(2vw)}'
  + '.n1{background:radial-gradient(circle,rgba(128,226,180,.38),rgba(128,226,180,0) 68%)}'
  + '.n2{background:radial-gradient(circle,rgba(217,154,32,.24),rgba(217,154,32,0) 65%)}'
  + '.n3{background:radial-gradient(circle,rgba(80,160,255,.18),rgba(80,160,255,0) 70%)}'
  + '.grid{position:absolute;left:-20%;right:-20%;bottom:-5%;height:75%;'
  +   'background-image:linear-gradient(rgba(128,226,180,.35) 0.12vw,transparent 0.12vw),'
  +   'linear-gradient(90deg,rgba(128,226,180,.35) 0.12vw,transparent 0.12vw);'
  +   'background-size:7vw 7vw;transform-origin:50% 100%;pointer-events:none}'
  + '.hex{position:absolute;inset:0;background-image:radial-gradient(rgba(128,226,180,.45) 0.15vw,transparent 0.18vw);'
  +   'background-size:4.2vw 4.2vw;pointer-events:none}'
  + '.scan{position:absolute;left:0;right:0;height:8vw;pointer-events:none;'
  +   'background:linear-gradient(180deg,transparent,rgba(128,226,180,.22),transparent)}'
  + '.bit{position:absolute;border-radius:50%;background:var(--kino-mint);box-shadow:0 0 1.2vw rgba(128,226,180,.7);'
  +   'pointer-events:none}'
  + '.hud{position:absolute;width:5vw;height:5vw;border-color:rgba(128,226,180,.55);border-style:solid;pointer-events:none}'
  + '.tl{left:3%;top:3%;border-width:0.2vw 0 0 0.2vw}.tr{right:3%;top:3%;border-width:0.2vw 0.2vw 0 0}'
  + '.bl{left:3%;bottom:3%;border-width:0 0 0.2vw 0.2vw}.br{right:3%;bottom:3%;border-width:0 0.2vw 0.2vw 0}'
  + '</style>';
}
function WIN(fieldHtml, caretOn, camStyle, ctaHtml) {
  var caret = '<b class="crt" style="opacity:' + (caretOn ? 1 : 0) + '">█</b>';
  var edge = Math.sin(env.progress * Math.PI);
  var floatY = edge * 0.55 * Math.sin(env.t * 2.1);
  var glow = 0.28 + 0.22 * edge * (0.5 + 0.5 * Math.sin(env.t * 3));
  return ''
  + TECH_BG()
  + '<div class="cam" style="transform:' + camStyle + '">'
  +   '<div class="win" style="transform:translateY(' + floatY.toFixed(2) + 'vw);'
  +     'box-shadow:0 0 6vw rgba(128,226,180,' + glow.toFixed(3) + '), inset 0 0 4vw rgba(128,226,180,.06)">'
  +     '<div class="bar"><span class="mark">kino</span><span class="dot" style="transform:scale('
  +       (1 + 0.35 * edge * (0.5 + 0.5 * Math.sin(env.t * 4))).toFixed(2) + ')"></span></div>'
  +     (ctaHtml || '')
  +     '<div class="field"><span class="txt">' + fieldHtml + caret + '</span>'
  +       '<span class="send">↑</span></div>'
  +   '</div>'
  + '</div>'
  + '<div class="kino-grain"></div><div class="kino-vignette"></div>'
  + '<style>'
  + '.cam{position:absolute;inset:0;transform-origin:50% 62%}'
  + '.win{position:absolute;left:9%;right:9%;top:24%;bottom:24%;border-radius:3vw;'
  +   'background:rgba(9,14,28,.72);border:0.18vw solid var(--kino-mint)}'
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

var p = env.progress;
var doneA = Math.max(0, 1 - p / 0.5);
var caretOn = env.progress > 0.95 || Math.floor(env.frame / 15) % 2 === 0;
var done = doneA > 0.01
  ? ('<div class="done" style="opacity:' + doneA.toFixed(3) + ';transform:scale('
    + (0.85 + 0.2 * doneA).toFixed(2) + ')">✓</div>'
    + '<style>.done{position:absolute;left:0;right:0;top:38%;text-align:center;'
    + 'font-family:var(--kino-font);color:var(--kino-mint);font-size:14vw;'
    + 'text-shadow:0 0 4vw rgba(128,226,180,.45)}</style>')
  : '';
// Stay at S=1 — no zoom-out from a prior beat (those now end native too)
var cam = "scale(1)";
return WIN("", caretOn, cam, done);
