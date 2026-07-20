// JSON / code editor that types a file across the VO span (Tier 2). Camera pans as
// lines fill. Extracted from the kino advert (spec-editor beat).
//
// Customize: FILENAME, LINES (the file body). Reveal is metered by env.words span.
// Copy into projects/<name>/assets/motion/ and: "source": "motion/json-type.js"
var FILENAME = "spec.json";
var LINES = [
  '{',
  '  "brand": "acme",',
  '  "title": "launch",',
  '  "format": ["9:16"],',
  '  "provider": "none",',
  '  "segments": [',
  '    { "kind": "motion",',
  '      "source": "prompt-type.js",',
  '      "text": "Make me an advert." },',
  '    { "kind": "motion",',
  '      "source": "build-pipeline.js",',
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
var pin = env.progress;
var ease = 1 - (1 - pin) * (1 - pin);
var S = 1 + 0.10 * ease;
var panY = -2 + (-10 * ease);
var panX = 0.8 * Math.sin(pin * Math.PI);
return ''
+ '<div class="bg"></div>'
+ '<div class="cam" style="transform:translate(' + panX.toFixed(2) + 'vw,' + panY.toFixed(2) + 'vw) scale(' + S.toFixed(4) + ')">'
+   '<div class="ed">'
+     '<div class="top"><span class="d r"></span><span class="d y"></span><span class="d g"></span>'
+       '<span class="fn">' + FILENAME + '</span></div>'
+     '<div class="body"><pre class="gut">' + gutter + '</pre>'
+       '<pre class="code">' + esc(shown) + '<b class="crt" style="opacity:' + (caretOn?1:0) + '">█</b></pre></div>'
+   '</div>'
+ '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.bg{position:absolute;inset:0;background:'
+   'radial-gradient(130% 90% at 50% 118%, color-mix(in srgb, var(--kino-mint) 20%, transparent), transparent 58%),'
+   'radial-gradient(110% 75% at 22% -12%, color-mix(in srgb, var(--kino-gold) 12%, transparent), transparent 55%),'
+   'var(--kino-night)}'
+ '.cam{position:absolute;inset:0;transform-origin:50% 38%}'
+ '.ed{position:absolute;left:6%;right:6%;top:14%;bottom:14%;border-radius:2.5vw;'
+   'background:color-mix(in srgb, var(--kino-night) 90%, #000);'
+   'border:0.12vw solid color-mix(in srgb, var(--kino-mint) 25%, transparent);overflow:hidden}'
+ '.top{height:7vw;display:flex;align-items:center;gap:1vw;padding:0 3vw;'
+   'background:color-mix(in srgb, var(--kino-mint) 5%, transparent)}'
+ '.d{width:1.4vw;height:1.4vw;border-radius:50%}.r{background:#ff5f57}.y{background:#febc2e}.g{background:#28c840}'
+ '.fn{margin-left:2vw;font-family:var(--kino-label-font);color:rgba(255,255,255,.6);font-size:2.4vw}'
+ '.body{display:flex;padding:3vw}'
+ '.gut{margin:0;color:color-mix(in srgb, var(--kino-mint) 40%, transparent);'
+   'font-family:var(--kino-label-font);font-size:2.2vw;line-height:3.1vw;text-align:right;padding-right:2vw}'
+ '.code{margin:0;color:var(--kino-white);font-family:var(--kino-label-font);font-size:2.2vw;'
+   'line-height:3.1vw;white-space:pre}'
+ '.crt{color:var(--kino-mint)}'
+ '</style>';

function esc(s){ return s.split("&").join("&amp;").split("<").join("&lt;").split(">").join("&gt;"); }
