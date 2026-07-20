// Terminal that types a build command, then lights pipeline steps off the last N
// spoken words (Tier 2). Extracted from the kino advert (build-terminal beat).
//
// Customize: CMD, STEPS (labels). Speak the step names in the VO (in order) so they
// light 1:1 — e.g. "… Voiceover, motion, render, mp4."
// Copy into projects/<name>/assets/motion/ and: "source": "motion/build-pipeline.js"
var CMD = "build advert.json";
var STEPS = ["voiceover", "motion", "render", "mp4"];
var KEY = 0.048;
var words = env.words || [];
var typeEnd = (words.length >= 2) ? words[1].end : 1.1;
var nCmd = Math.min(CMD.length, Math.floor((Math.max(0, env.t) / Math.max(0.4, typeEnd)) * CMD.length));
if (words.length && env.t > words[0].start) {
  var burst = Math.min(CMD.length, Math.floor((env.t - words[0].start) / KEY) + 1);
  nCmd = Math.max(nCmd, burst);
  if (words.length >= STEPS.length && env.t >= words[words.length - STEPS.length].start) nCmd = CMD.length;
}
var typed = CMD.slice(0, nCmd);
var cmdDone = nCmd >= CMD.length;
var caretOn = !cmdDone || Math.floor(env.frame / 15) % 2 === 0;

var nw = words.length, nSteps = STEPS.length;
var sched;
if (nw >= nSteps) {
  sched = [];
  for (var s = 0; s < nSteps; s++) sched.push(words[nw - nSteps + s].start);
} else {
  sched = [1.4, 1.9, 2.4, 2.85].slice(0, nSteps);
}
function state(k){
  if (env.t < sched[k]) return 0;
  var next = (k < nSteps - 1) ? sched[k + 1] : sched[nSteps - 1] + 0.45;
  return env.t < next ? 1 : 2;
}
var rows = "";
for (var k = 0; k < nSteps; k++){
  var st = state(k);
  var col = st === 2 ? "var(--kino-mint)" : st === 1 ? "var(--kino-gold)" : "rgba(255,255,255,.25)";
  var glow = st === 1 ? "0 0 2.2vw " + col : "none";
  var mark = st === 2 ? "✓" : st === 1 ? "●" : "○";
  var pop = 1 + 0.06 * (st === 1 ? env.pulse : 0);
  rows += '<div class="row" style="transform:scale(' + pop.toFixed(3) + ')">'
    + '<span class="ic" style="color:' + col + ';box-shadow:' + glow + '">' + mark + '</span>'
    + '<span class="lbl" style="color:' + (st ? "var(--kino-white)" : "rgba(255,255,255,.4)") + '">'
    + STEPS[k] + '</span></div>';
}
var pin = env.progress;
var ease = 1 - (1 - pin) * (1 - pin);
var S = 1 + 0.08 * ease;
var panY = -1.5 * ease;
return ''
+ '<div class="bg"></div>'
+ '<div class="cam" style="transform:translateY(' + panY.toFixed(2) + 'vw) scale(' + S.toFixed(4) + ')">'
+   '<div class="term">'
+     '<div class="cmd"><span class="pr">›</span> ' + typed
+     '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></div>'
+     '<div class="pipe">' + rows + '</div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.bg{position:absolute;inset:0;background:'
+   'radial-gradient(130% 90% at 50% 118%, color-mix(in srgb, var(--kino-mint) 20%, transparent), transparent 58%),'
+   'radial-gradient(110% 75% at 22% -12%, color-mix(in srgb, var(--kino-gold) 12%, transparent), transparent 55%),'
+   'var(--kino-night)}'
+ '.cam{position:absolute;inset:0;transform-origin:50% 45%}'
+ '.term{position:absolute;left:7%;right:7%;top:18%;bottom:18%;border-radius:2.5vw;'
+   'background:color-mix(in srgb, var(--kino-night) 92%, #000);'
+   'border:0.12vw solid color-mix(in srgb, var(--kino-mint) 20%, transparent);padding:5vw;'
+   'display:flex;flex-direction:column}'
+ '.cmd{font-family:var(--kino-label-font);color:var(--kino-white);font-size:4vw}'
+ '.pr{color:var(--kino-mint)}.crt{color:var(--kino-mint)}'
+ '.pipe{flex:1;display:flex;flex-direction:column;gap:6vw;align-items:center;justify-content:center}'
+ '.row{display:flex;align-items:center;gap:4vw;min-width:58vw}'
+ '.ic{width:8.5vw;height:8.5vw;border-radius:50%;border:0.25vw solid currentColor;'
+   'display:flex;align-items:center;justify-content:center;font-size:4.2vw}'
+ '.lbl{font-family:var(--kino-font);font-size:5.6vw}'
+ '</style>';
