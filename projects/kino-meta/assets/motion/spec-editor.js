// Real kino schema typing in the editor. Burst-type over the VO span.
// Tech bg is seam-safe (edge=sin(progress*π) → 0 at beat ends). Camera rides TIME.
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

var LINES = [
  '{',
  '  "brand": "kino",',
  '  "title": "advert",',
  '  "format": ["9:16"],',
  '  "provider": "none",',
  '  "voiceModel": "eleven_multilingual_v2",',
  '  "segments": [',
  '    { "kind": "motion",',
  '      "source": "prompt-window.js",',
  '      "text": "Kino, make me an advert." },',
  '    { "kind": "motion",',
  '      "source": "spec-editor.js",',
  '      "text": "Your agent writes a real JSON spec." },',
  '    { "kind": "motion",',
  '      "source": "build-terminal.js",',
  '      "text": "One command builds it." }',
  '  ]',
  '}'
];
var full = LINES.join("\n");
var words = env.words || [];
var t0 = words.length ? words[0].start : 0;
var t1 = words.length ? words[words.length - 1].end : 1;
var span = Math.max(0.4, t1 - t0);
var elapsed = Math.max(0, env.t - t0);
var shownN = words.length && env.t > t0
  ? Math.min(full.length, Math.floor((elapsed / span) * full.length))
  : 0;
var shown = full.slice(0, shownN);
var typing = shownN < full.length;
var caretOn = typing || Math.floor(env.frame / 15) % 2 === 0;
var vis = shown.split("\n");
var gutter = "", i;
for (i = 0; i < vis.length; i++) gutter += (i + 1) + "\n";
// Native at beat edges (matches prompt end / build start) — soft mid breath only.
// Old ease-out push + -12vw pan made the cut into the terminal feel like a whip-zoom.
var edge = Math.sin(env.progress * Math.PI);
var breath = Math.sin(env.progress * Math.PI);
var S = 1 + 0.04 * breath;
var panY = -1.5 * breath; // slight downward drift as lines fill — not a hard dive
var floatY = edge * 0.25 * Math.sin(env.t * 1.8);
var glow = 0.2 + 0.25 * edge;
return ''
+ TECH_BG()
+ '<div class="cam" style="transform:translateY(' + panY.toFixed(2) + 'vw) scale(' + S.toFixed(4) + ')">'
+   '<div class="ed" style="transform:translateY(' + floatY.toFixed(2) + 'vw);'
+     'box-shadow:0 0 5vw rgba(128,226,180,' + glow.toFixed(3) + ')">'
+     '<div class="top"><span class="d r"></span><span class="d y"></span><span class="d g"></span>'
+       '<span class="fn">advert.json</span>'
+       '<span class="live" style="opacity:' + (0.4 + 0.6 * edge).toFixed(2) + '">● live</span></div>'
+     '<div class="body"><pre class="gut">' + gutter + '</pre>'
+       '<pre class="code">' + esc(shown) + '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></pre></div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.cam{position:absolute;inset:0;transform-origin:50% 38%}'
+ '.ed{position:absolute;left:6%;right:6%;top:14%;bottom:14%;border-radius:2.5vw;'
+   'background:rgba(9,14,28,.85);border:0.12vw solid rgba(128,226,180,.35);overflow:hidden}'
+ '.top{height:7vw;display:flex;align-items:center;gap:1vw;padding:0 3vw;'
+   'background:rgba(128,226,180,.05)}'
+ '.d{width:1.4vw;height:1.4vw;border-radius:50%}.r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}'
+ '.fn{margin-left:2vw;font-family:var(--kino-label-font);color:rgba(255,255,255,.6);font-size:2.4vw;flex:1}'
+ '.live{font-family:var(--kino-label-font);color:var(--kino-mint);font-size:2vw}'
+ '.body{display:flex;padding:3vw}'
+ '.gut{margin:0;color:rgba(128,226,180,.4);font-family:var(--kino-label-font);font-size:2.2vw;'
+   'line-height:3.1vw;text-align:right;padding-right:2vw}'
+ '.code{margin:0;color:var(--kino-white);font-family:var(--kino-label-font);font-size:2.2vw;'
+   'line-height:3.1vw;white-space:pre}'
+ '.crt{color:var(--kino-mint)}'
+ '</style>';

function esc(s){ return s.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;"); }
