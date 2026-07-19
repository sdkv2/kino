var CMD = "kino build advert.json";
var KEY = 0.05;
// type the command over the first ~1s off --t (independent of VO words here)
var n = Math.min(CMD.length, Math.floor(env.t / KEY));
var typed = CMD.slice(0, n);
var cmdDone = n >= CMD.length;
var caretOn = !cmdDone || Math.floor(env.frame / 15) % 2 === 0;
// pipeline steps light up on a schedule after the command finishes typing (~1.1s)
var steps = ["voiceover", "motion", "render", "mp4"];
var t0 = 1.1, per = 0.45;
function state(k){
  var s = t0 + k * per;                 // when this step activates
  if (env.t < s) return 0;              // pending
  if (env.t < s + per) return 1;        // active (glowing)
  return 2;                             // done (checked)
}
var rows = "";
for (var k = 0; k < steps.length; k++){
  var st = state(k);
  var col = st === 2 ? "var(--kino-mint)" : st === 1 ? "var(--kino-gold)" : "rgba(255,255,255,.25)";
  var glow = st === 1 ? "0 0 3vw " + col : "none";
  var mark = st === 2 ? "✓" : st === 1 ? "●" : "○";
  // pulse the active row with the trigger envelope
  var pop = 1 + 0.12 * (st === 1 ? env.pulse : 0);
  rows += '<div class="row" style="transform:scale(' + pop.toFixed(3) + ')">'
    + '<span class="ic" style="color:' + col + ';box-shadow:' + glow + '">' + mark + '</span>'
    + '<span class="lbl" style="color:' + (st ? "var(--kino-white)" : "rgba(255,255,255,.4)") + '">'
    + steps[k] + '</span></div>';
}
return ''
+ '<div class="bg"></div>'
+ '<div class="term">'
+   '<div class="cmd"><span class="pr">›</span> ' + typed
+   '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></div>'
+   '<div class="pipe">' + rows + '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.bg{position:absolute;inset:0;background:'
+   'radial-gradient(130% 90% at 50% 118%, rgba(128,226,180,.20), rgba(128,226,180,0) 58%),'
+   'radial-gradient(110% 75% at 22% -12%, rgba(217,154,32,.12), rgba(217,154,32,0) 55%),'
+   '#0b1020}'
+ '.term{position:absolute;left:7%;right:7%;top:18%;bottom:18%;border-radius:2.5vw;'
+   'background:rgba(6,10,22,.9);border:0.12vw solid rgba(128,226,180,.2);padding:5vw}'
+ '.cmd{font-family:var(--kino-label-font);color:var(--kino-white);font-size:4vw}'
+ '.pr{color:var(--kino-mint)}.crt{color:var(--kino-mint)}'
+ '.pipe{margin-top:6vw;display:flex;flex-direction:column;gap:4vw;align-items:center}'
+ '.row{display:flex;align-items:center;gap:2.5vw;min-width:44vw}'
+ '.ic{width:6vw;height:6vw;border-radius:50%;border:0.2vw solid currentColor;'
+   'display:flex;align-items:center;justify-content:center;font-size:3vw}'
+ '.lbl{font-family:var(--kino-font);font-size:4vw}'
+ '</style>';
