// three tiles ignite in sequence (staggered off --progress), each a kino capability
var tiles = [
  { label: "captions", body: '<div class="capline">the timer.</div>' },
  { label: "motion", body: '<div class="num">86%</div>' },
  { label: "footage", body: '<div class="phone"></div>' }
];
var html = "";
for (var i = 0; i < tiles.length; i++){
  var start = 0.1 + i * 0.18;                       // stagger
  var a = Math.max(0, Math.min(1, (env.progress - start) * 6));
  var y = (1 - a) * 6;                              // rise vw
  html += '<div class="tile" style="opacity:' + a.toFixed(3)
    + ';transform:translateY(' + y.toFixed(2) + 'vw) scale(' + (0.96 + 0.04*a).toFixed(3) + ')">'
    + '<div class="inner">' + tiles[i].body + '</div>'
    + '<div class="cap">' + tiles[i].label + '</div></div>';
}
return '<div class="bg"></div><div class="wrap">' + html + '</div>'
+ '<div class="kino-grain"></div><div class="kino-vignette"></div>'
+ '<style>'
+ '.bg{position:absolute;inset:0;background:'
+   'radial-gradient(130% 90% at 50% 118%, rgba(128,226,180,.20), rgba(128,226,180,0) 58%),'
+   'radial-gradient(110% 75% at 22% -12%, rgba(217,154,32,.12), rgba(217,154,32,0) 55%),'
+   '#0b1020}'
+ '.wrap{position:absolute;left:8%;right:10%;top:30%;display:flex;flex-direction:column;gap:3vw}'
+ '.tile{border-radius:2.5vw;background:rgba(9,14,28,.8);border:0.12vw solid rgba(128,226,180,.25);'
+   'height:16vw;display:flex;align-items:center;justify-content:space-between;padding:0 4vw}'
+ '.inner{flex:1;display:flex;align-items:center;justify-content:center;height:100%}'
+ '.cap{font-family:var(--kino-label-font);color:rgba(128,226,180,.9);font-size:3vw}'
+ '.capline{font-family:var(--kino-font);color:#fff;font-size:5vw;'
+   'background:rgba(11,16,32,.9);padding:.5vw 2vw;border-radius:1vw;'
+   'box-shadow:0 0 0 .3vw var(--kino-mint) inset}'
+ '.num{font-family:var(--kino-font);color:var(--kino-mint);font-weight:900;font-size:8vw}'
+ '.phone{width:9vw;height:15vw;border-radius:1.6vw;border:0.3vw solid var(--kino-white);'
+   'background:linear-gradient(var(--kino-green),var(--kino-night))}'
+ '</style>';
