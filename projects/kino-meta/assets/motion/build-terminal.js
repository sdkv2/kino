var CMD = "kino build advert.json";
var KEY = 0.05;
// type the command over the first ~1s off --t (independent of VO words here)
var n = Math.min(CMD.length, Math.floor(env.t / KEY));
var typed = CMD.slice(0, n);
var cmdDone = n >= CMD.length;
var caretOn = !cmdDone || Math.floor(env.frame / 15) % 2 === 0;
// pipeline steps light up as each VO word is spoken (env.words = beat-relative {word,start,end}[])
var steps = ["voiceover", "motion", "render", "mp4"];
var w = env.words || [], n = w.length;
// NB: named `sched` (not `st`) — the loop below reuses `st` as a per-iteration var, and since JS
// `var` is function-scoped, reusing this name here would clobber the schedule array after k=0.
var sched = (n >= 3) ? [w[n-3].start, w[n-2].start, w[n-1].start, w[n-1].start + 0.5]
                     : [1.1, 1.55, 2.0, 2.45];   // fallback if no VO words
function state(k){
  if (env.t < sched[k]) return 0;                    // pending
  var next = (k < 3) ? sched[k+1] : sched[3] + 0.35; // mp4 has no next word
  return env.t < next ? 1 : 2;                        // active : done
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
+   'background:rgba(6,10,22,.9);border:0.12vw solid rgba(128,226,180,.2);padding:5vw;'
+   'display:flex;flex-direction:column}'
+ '.cmd{font-family:var(--kino-label-font);color:var(--kino-white);font-size:4vw}'
+ '.pr{color:var(--kino-mint)}.crt{color:var(--kino-mint)}'
+ '.pipe{flex:1;display:flex;flex-direction:column;gap:7vw;align-items:center;justify-content:center}'
+ '.row{display:flex;align-items:center;gap:4vw;min-width:58vw}'
+ '.ic{width:9vw;height:9vw;border-radius:50%;border:0.25vw solid currentColor;'
+   'display:flex;align-items:center;justify-content:center;font-size:4.5vw}'
+ '.lbl{font-family:var(--kino-font);font-size:6vw}'
+ '</style>';
