// A stylised editor. The typed lines are REAL kino schema keys (honest).
// env.words drives how far through the spec we've typed (burst feel via char meter).
var LINES = [
  '{',
  '  "brand": "kino",',
  '  "format": ["9:16"],',
  '  "voice": "rachel",',
  '  "provider": "none",',
  '  "segments": [',
  '    { "kind": "motion", "source": "prompt-window.js",',
  '      "text": "Kino, make me an advert" },',
  '    { "kind": "motion", "source": "spec-editor.js",',
  '      "text": "Your agent writes the spec" },',
  '    { "kind": "motion", "source": "build-terminal.js",',
  '      "text": "One command builds it" }',
  '  ]',
  '}'
];
var full = LINES.join("\n");
var words = env.words || [];
// fraction of the spec revealed = fraction of spoken words started, metered smooth by --t
var wStarted = 0, i;
for (i = 0; i < words.length; i++) { if (env.t >= words[i].start) wStarted++; }
var frac = words.length ? (wStarted + Math.min(1, (env.t - (words[Math.max(0,wStarted-1)]||{start:0}).start) / 0.25)) / words.length : env.progress;
frac = Math.max(0, Math.min(1, frac));
var shown = full.slice(0, Math.floor(full.length * frac));
var caretOn = frac < 1 || Math.floor(env.frame / 15) % 2 === 0;
// gutter line numbers for however many lines are visible
var vis = shown.split("\n");
var gutter = "";
for (i = 0; i < vis.length; i++) gutter += (i + 1) + "\n";
// gentle downward pan as more lines fill
var panY = -6 * env.progress; // vw
return ''
+ '<div class="bg"></div>'
+ '<div class="cam" style="transform:translateY(' + panY.toFixed(2) + 'vw)">'
+   '<div class="ed">'
+     '<div class="top"><span class="d r"></span><span class="d y"></span><span class="d g"></span>'
+       '<span class="fn">advert.json</span></div>'
+     '<div class="body"><pre class="gut">' + gutter + '</pre>'
+       '<pre class="code">' + esc(shown) + '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></pre></div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.bg{position:absolute;inset:0;background:'
+   'radial-gradient(130% 90% at 50% 118%, rgba(128,226,180,.20), rgba(128,226,180,0) 58%),'
+   'radial-gradient(110% 75% at 22% -12%, rgba(217,154,32,.12), rgba(217,154,32,0) 55%),'
+   '#0b1020}'
+ '.cam{position:absolute;inset:0;transform-origin:50% 40%}'
+ '.ed{position:absolute;left:6%;right:6%;top:16%;bottom:16%;border-radius:2.5vw;'
+   'background:rgba(9,14,28,.85);border:0.12vw solid rgba(128,226,180,.25);overflow:hidden}'
+ '.top{height:7vw;display:flex;align-items:center;gap:1vw;padding:0 3vw;'
+   'background:rgba(128,226,180,.05)}'
+ '.d{width:1.4vw;height:1.4vw;border-radius:50%}.r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}'
+ '.fn{margin-left:2vw;font-family:var(--kino-label-font);color:rgba(255,255,255,.6);font-size:2.4vw}'
+ '.body{display:flex;padding:3vw}'
+ '.gut{margin:0;color:rgba(128,226,180,.4);font-family:var(--kino-label-font);font-size:2.4vw;'
+   'line-height:3.4vw;text-align:right;padding-right:2vw}'
+ '.code{margin:0;color:var(--kino-white);font-family:var(--kino-label-font);font-size:2.4vw;'
+   'line-height:3.4vw;white-space:pre}'
+ '.crt{color:var(--kino-mint)}'
+ '</style>';

function esc(s){ return s.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;"); }
