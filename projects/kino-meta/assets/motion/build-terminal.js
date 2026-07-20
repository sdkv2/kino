// Terminal types the build command; pipeline steps light with VO.
// Tech bg seam-safe. Camera rides TIME; active row pops on pulse.
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

var CMD = "kino build advert.json";
var KEY = 0.048;
var words = env.words || [];
var typeEnd = (words.length >= 2) ? words[1].end : 1.1;
var nCmd = Math.min(CMD.length, Math.floor((Math.max(0, env.t) / Math.max(0.4, typeEnd)) * CMD.length));
if (words.length && env.t > words[0].start) {
  var burst = Math.min(CMD.length, Math.floor((env.t - words[0].start) / KEY) + 1);
  nCmd = Math.max(nCmd, burst);
  if (words.length >= 4 && env.t >= words[words.length - 4].start) nCmd = CMD.length;
}
var typed = CMD.slice(0, nCmd);
var cmdDone = nCmd >= CMD.length;
var caretOn = !cmdDone || Math.floor(env.frame / 15) % 2 === 0;

var steps = ["voiceover", "motion", "render", "mp4"];
var nw = words.length;
var sched = (nw >= 4)
  ? [words[nw - 4].start, words[nw - 3].start, words[nw - 2].start, words[nw - 1].start]
  : [1.4, 1.9, 2.4, 2.85];
function state(k){
  if (env.t < sched[k]) return 0;
  var next = (k < 3) ? sched[k + 1] : sched[3] + 0.45;
  return env.t < next ? 1 : 2;
}
var rows = "";
for (var k = 0; k < steps.length; k++){
  var st = state(k);
  var col = st === 2 ? "var(--kino-mint)" : st === 1 ? "var(--kino-gold)" : "rgba(255,255,255,.25)";
  var glow = st === 1 ? "0 0 2.8vw " + col : st === 2 ? "0 0 1.2vw " + col : "none";
  var mark = st === 2 ? "✓" : st === 1 ? "●" : "○";
  var pop = 1 + 0.10 * (st === 1 ? env.pulse : 0) + (st === 1 ? 0.04 : 0);
  var slide = st === 0 ? 2.5 : 0;
  var a = st === 0 ? 0.45 : 1;
  rows += '<div class="row" style="transform:translateX(' + (-slide).toFixed(1) + 'vw) scale(' + pop.toFixed(3)
    + ');opacity:' + a.toFixed(2) + '">'
    + '<span class="ic" style="color:' + col + ';box-shadow:' + glow + '">' + mark + '</span>'
    + '<span class="lbl" style="color:' + (st ? "var(--kino-white)" : "rgba(255,255,255,.4)") + '">'
    + steps[k] + '</span>'
    + (k < 3 ? '<span class="rail" style="opacity:' + (st === 2 ? 0.7 : 0.15).toFixed(2) + '"></span>' : '')
    + '</div>';
}
// Native at edges so the cut from spec-editor doesn't pop; tiny mid-beat breath only.
var edge = Math.sin(env.progress * Math.PI);
var breath = Math.sin(env.progress * Math.PI);
var S = 1 + 0.04 * breath;
var panY = -0.8 * breath;
var floatY = edge * 0.25 * Math.sin(env.t * 1.7);
var termGlow = 0.18 + 0.28 * edge;
// Continuous fill across the pipeline VO span (last 4 nouns → end of last word).
// Per-step 25% chunks looked stuck on short words like "Voiceover,".
var barT0 = sched[0];
var barT1 = (nw >= 4 ? words[nw - 1].end : sched[3]) + 0.2;
var barW = 0;
if (env.t >= barT1) barW = 100;
else if (env.t > barT0) barW = 100 * (env.t - barT0) / Math.max(0.25, barT1 - barT0);
else barW = 8 * (nCmd / Math.max(1, CMD.length)); // tease while the command types
return ''
+ TECH_BG()
+ '<div class="cam" style="transform:translateY(' + panY.toFixed(2) + 'vw) scale(' + S.toFixed(4) + ')">'
+   '<div class="term" style="transform:translateY(' + floatY.toFixed(2) + 'vw);'
+     'box-shadow:0 0 5vw rgba(128,226,180,' + termGlow.toFixed(3) + ')">'
+     '<div class="cmd"><span class="pr">›</span> ' + typed
+     '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></div>'
+     '<div class="bartrack"><div class="barfill" style="width:' + barW.toFixed(1) + '%"></div></div>'
+     '<div class="pipe">' + rows + '</div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.cam{position:absolute;inset:0;transform-origin:50% 45%}'
+ '.term{position:absolute;left:7%;right:7%;top:16%;bottom:16%;border-radius:2.5vw;'
+   'background:rgba(6,10,22,.9);border:0.12vw solid rgba(128,226,180,.28);padding:4.5vw;'
+   'display:flex;flex-direction:column}'
+ '.cmd{font-family:var(--kino-label-font);color:var(--kino-white);font-size:3.8vw}'
+ '.pr{color:var(--kino-mint)}.crt{color:var(--kino-mint)}'
+ '.bartrack{margin:3vw 0 1vw;height:0.7vw;border-radius:1vw;background:rgba(128,226,180,.12);overflow:hidden}'
+ '.barfill{height:100%;background:linear-gradient(90deg,var(--kino-mint),var(--kino-gold));'
+   'box-shadow:0 0 1.5vw rgba(128,226,180,.5)}'
+ '.pipe{flex:1;display:flex;flex-direction:column;gap:4.5vw;align-items:center;justify-content:center}'
+ '.row{display:flex;align-items:center;gap:3.5vw;min-width:58vw;position:relative}'
+ '.ic{width:8vw;height:8vw;border-radius:50%;border:0.25vw solid currentColor;'
+   'display:flex;align-items:center;justify-content:center;font-size:4vw;flex-shrink:0}'
+ '.lbl{font-family:var(--kino-font);font-size:5.2vw}'
+ '.rail{position:absolute;left:3.7vw;top:8vw;width:0.25vw;height:4vw;background:var(--kino-mint)}'
+ '</style>';
