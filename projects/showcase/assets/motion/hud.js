// Viewfinder HUD overlay (procedural) — live frame counter, timecode, buffer %, REC blink and a
// progress rail. Every readout derives from env, so the layer changes every single frame by
// construction. Sits in the top band, clear of kino's caption area.
const pad = (n, w) => String(n).padStart(w, "0");
const fr = pad(env.frame, 4);
const s = Math.floor(env.t);
const tc = `${pad(Math.floor(s / 60), 2)}:${pad(s % 60, 2)}:${pad(env.frame % 30, 2)}`;
const recOn = Math.floor(env.t * 2) % 2 === 0;
const pct = pad(Math.round(env.progress * 100), 3);
return `
<style>
  .hud { position: absolute; inset: 0; font-family: monospace; color: var(--kino-white);
         opacity: clamp(0, calc(var(--progress) * 8), 1); }
  .row { position: absolute; left: 64px; right: 64px; display: flex;
         justify-content: space-between; font-size: 30px; letter-spacing: 0.08em; }
  .r1 { top: 150px; } .r2 { top: 208px; }
  .rail { position: absolute; left: 64px; right: 64px; top: 266px; height: 3px;
          background: rgba(22,19,13,0.18); }
  .fill { height: 100%; background: var(--kino-green); width: ${(env.progress * 100).toFixed(2)}%; }
  .rec { color: var(--kino-green); opacity: ${recOn ? 1 : 0.25}; }
</style>
<div class="hud">
  <div class="row r1"><span>FR ${fr}</span><span class="rec">&#9679; REC</span></div>
  <div class="row r2"><span>TC ${tc}</span><span>BUF ${pct}%</span></div>
  <div class="rail"><div class="fill"></div></div>
</div>`;
