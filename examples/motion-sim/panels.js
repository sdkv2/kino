// Pure `(env) => string`, as always — it reads a row and keeps nothing. What is new is that the row
// describes a point in THREE dimensions, and CSS can draw that directly: a `perspective` container
// plus `translate3d` and `rotateX/rotateY` per panel is real projection, not a fake.

// Must exceed every z the solver produces (measured max ~1150). A panel at translateZ(Z) under
// `perspective: P` scales by P/(P−Z); at Z = P it is the eye itself and the element explodes to
// infinity, then vanishes. The margin here is deliberate, not decorative.
const P = 2600;

const row = env.sim.at || [];

// PAINTER'S ALGORITHM. Sort far → near so nearer panels paint over farther ones. `preserve-3d`
// makes browsers do this themselves in simple cases, but the ordering is exactly the thing that
// makes a swarm read as a volume rather than as a pile of decals, so it is worth owning outright.
const sorted = row.map((p, i) => ({ p, i })).sort((a, b) => a.p[2] - b.p[2]);

const RAD = Math.PI / 180;
const ROLE = ["var(--kino-ok)", "var(--kino-warn)", "var(--kino-danger)", "var(--kino-accent)"];

// A slow camera drift, driven by progress rather than by the solve. Once the last panel lands there
// are still a few hundred milliseconds of beat left, and a wall that is merely finished is a wall
// that has stopped; a degree of parallax keeps it alive. This is the half that needs no memory, so
// it belongs here and not in the solver.
const camY = -7 + 14 * env.inout;
const camX = 3 - 5 * env.inout;

const panels = sorted
  .map(({ p, i }) => {
    const [x, y, z, rx, ry, speed, impact, isHero] = p;
    const hero = isHero === 1;

    // The hero is bigger, nearer and the only saturated thing in frame. Three signals pointing at
    // one element is what gives the shot a subject; any one of them alone reads as a variation.
    const w = hero ? 292 : 214;
    const h = hero ? 366 : 268;
    const key = hero ? "var(--kino-accent)" : "var(--kino-line)";

    // Which way is this panel facing? This is the z-component of its normal after
    // `rotateX(rx) rotateY(ry)`, so it is 0 exactly edge-on and ±1 exactly face-on.
    //
    // `backface-visibility` is rejected by kino's lint, and the sanctioned substitute is to gate
    // each face's OPACITY off the flip driver. The first draft here swapped one element's styling
    // on `facing >= 0` instead, and that popped badly: panels linger near edge-on for many frames
    // (measured — one crosses at frames 4, 9 and 11), so a hard swap flickers a sliver between a
    // near-black back and a fully-lit front, then opens straight to full brightness. Three things
    // fix it, and all three are needed:
    //
    //   1. TWO STACKED FACES, cross-faded over a small window either side of edge-on, so nothing
    //      ever switches instantaneously. This is the substitute the lint actually names.
    //   2. A BRIGHTNESS RAMP with |facing|. A surface turned edge-on to the light catches almost
    //      none of it; ramping in means the card brightens as it opens instead of arriving lit.
    //      This is what removes the pop, more than the cross-fade does.
    //   3. A back that is a MATERIAL, not a hole — see backCss.
    const facing = Math.cos(rx * RAD) * Math.cos(ry * RAD);
    const frontOpacity = Math.min(1, Math.max(0, 0.5 + facing / 0.32));
    const lit = (0.34 + 0.66 * Math.min(1, Math.abs(facing))).toFixed(3);

    // Depth cue: atmospheric fade for panels BEHIND the wall plane, and nothing at all in front of
    // it. Fading by absolute depth instead was the first draft, and it left every settled panel at
    // 76% opacity — a whole wall reading as translucent glass because the cue was still applying at
    // z = 0, where it should be zero. A depth effect has to bottom out exactly where the subject
    // lands, or it stops being depth and becomes a wash.
    const far = Math.min(1, Math.max(0, -z / 900));

    // The velocity the solver already computed, spent on motion blur. A panel crossing the frame
    // at 3000px/s and rendered crisp reads as a slide; blurred, it reads as travel.
    const blur = Math.min(9, speed / 260).toFixed(2);

    // THE LANDING. The solver said which frame this panel stopped on; spend it on a glint that
    // rides the edge and a brief lift in brightness. Twelve of these across the beat is what turns
    // a smooth assembly into something with a rhythm — the eye gets a beat to follow.
    const flash = Number(impact) || 0;

    // A sheen that tracks the panel's own rotation, so turning through the light catches it. One
    // light direction, consistently applied, is most of what makes flat fills read as material.
    const sheen = (50 + Math.sin(ry * RAD) * 46).toFixed(1);

    // ONE KEY LIGHT, from the upper left, applied consistently to every face on both sides. The
    // gradient angle tracks each panel's own rotation, so turning through the key is what lights it.
    const base = hero
      ? `color-mix(in srgb, var(--kino-surface) 84%, var(--kino-accent) 16%)`
      : `var(--kino-surface)`;
    const frontCss = `background:
           linear-gradient(${(115 + ry * 0.4).toFixed(1)}deg,
             color-mix(in srgb, ${base} 62%, var(--kino-fg) 38%) 0%,
             color-mix(in srgb, ${base} 82%, var(--kino-fg) 18%) 44%,
             color-mix(in srgb, ${base} 96%, #000 4%) 100%);
         box-shadow: inset 0 2px 0 color-mix(in srgb, var(--kino-fg) ${(40 + 45 * flash).toFixed(0)}%, transparent),
                     inset 0 0 ${(26 * flash).toFixed(1)}px color-mix(in srgb, ${key} ${(70 * flash).toFixed(0)}%, transparent);
         border: ${hero ? 3 : 2}px solid color-mix(in srgb, ${key} ${(100 * (hero ? 1 : 0.62 + 0.38 * flash)).toFixed(0)}%, var(--kino-line))`;

    // The back carries no content — that is what sells the tumble — but it is still a lit surface.
    // Painting it near-black made every turning panel read as a hole punched in the frame, and a
    // hole appearing is a pop no cross-fade can hide. It takes the same gradient angle as the front
    // so both faces agree about where the light is.
    const backCss = `background:
           linear-gradient(${(115 + ry * 0.4).toFixed(1)}deg,
             color-mix(in srgb, ${base} 74%, var(--kino-fg) 12%) 0%,
             color-mix(in srgb, ${base} 92%, #000 8%) 62%,
             color-mix(in srgb, ${base} 80%, #000 20%) 100%);
         border: 2px solid color-mix(in srgb, var(--kino-line) 72%, transparent)`;

    const content = `<div style="position:absolute;inset:20px;display:flex;flex-direction:column;gap:14px">
           <div style="display:flex;align-items:center;gap:12px">
             <span style="width:14px;height:14px;border-radius:50%;background:${ROLE[i % 4]}"></span>
             <span style="height:12px;flex:1;border-radius:6px;
               background:color-mix(in srgb, var(--kino-fg) ${hero ? 82 : 46}%, transparent)"></span>
           </div>
           <div style="height:10px;width:76%;border-radius:5px;
             background:color-mix(in srgb, var(--kino-muted) ${hero ? 92 : 66}%, transparent)"></div>
           <div style="height:10px;width:52%;border-radius:5px;
             background:color-mix(in srgb, var(--kino-muted) ${hero ? 74 : 48}%, transparent)"></div>
           <div style="margin-top:auto;height:${hero ? 46 : 34}px;border-radius:10px;
             background:${hero ? "var(--kino-accent)" : `color-mix(in srgb, ${ROLE[i % 4]} 16%, transparent)`};
             border:1px solid color-mix(in srgb, ${hero ? "var(--kino-accent)" : ROLE[i % 4]} 42%, transparent)"></div>
         </div>
         <div style="position:absolute;inset:0;border-radius:18px;pointer-events:none;
           background:linear-gradient(${(105 + ry * 0.5).toFixed(1)}deg,
             transparent ${(sheen - 26).toFixed(1)}%,
             color-mix(in srgb, var(--kino-fg) 26%, transparent) ${sheen}%,
             transparent ${(Number(sheen) + 26).toFixed(1)}%)"></div>`;

    // The drop shadow and the depth fade belong to the PANEL; the two faces sit inside it and only
    // differ in how they are painted, so neither can double the shadow or fight the other's opacity.
    return `<div style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;margin:${-h / 2}px 0 0 ${-w / 2}px;
      transform:translate3d(${x}px, ${y}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg);
      transform-style:preserve-3d;border-radius:18px;
      box-shadow:0 26px 60px rgba(0,0,0,.5)${hero ? `, 0 0 90px color-mix(in srgb, var(--kino-accent) 26%, transparent)` : ""}${
        flash > 0.02 ? `, 0 0 ${(70 * flash).toFixed(0)}px color-mix(in srgb, ${key} ${(55 * flash).toFixed(0)}%, transparent)` : ""};
      filter:blur(${blur}px) brightness(${(Number(lit) * (1 + 0.5 * flash)).toFixed(3)});opacity:${(1 - 0.58 * far).toFixed(3)}">
      <div style="position:absolute;inset:0;border-radius:18px;opacity:${(1 - frontOpacity).toFixed(3)};${backCss}"></div>
      <div style="position:absolute;inset:0;border-radius:18px;opacity:${frontOpacity.toFixed(3)};${frontCss}">${content}</div>
    </div>`;
  })
  .join("");

// STAGING — the slots the panels are flying to, drawn at z = 0. The solver knows this geometry and
// an earlier demo in this folder did not draw the equivalent, which left its bodies stopping against
// nothing for no visible reason. A viewer who cannot see what the motion is resolving TO reads the
// motion as arbitrary.
const COLS = 3;
const ROWS = 4;
const GAP_X = 300;
const GAP_Y = 292;
const ox = env.width / 2 - ((COLS - 1) * GAP_X) / 2;
const oy = env.height * 0.5 - ((ROWS - 1) * GAP_Y) / 2;
const slots = Array.from({ length: COLS * ROWS }, (_, i) => {
  const cx = ox + (i % COLS) * GAP_X;
  const cy = oy + Math.floor(i / COLS) * GAP_Y;
  return `<div style="position:absolute;left:0;top:0;width:214px;height:268px;margin:-134px 0 0 -107px;
    transform:translate3d(${cx}px, ${cy}px, 0px);border-radius:18px;
    border:2px dashed color-mix(in srgb, var(--kino-line) 70%, transparent);
    opacity:${(0.5 * (1 - env.inout)).toFixed(3)}"></div>`;
}).join("");

return `<div style="position:absolute;inset:0;perspective:${P}px;perspective-origin:50% 50%">
  <div style="position:absolute;inset:0;transform-style:preserve-3d;
    transform:rotateX(${camX.toFixed(2)}deg) rotateY(${camY.toFixed(2)}deg)">
    ${slots}${panels}
  </div>
  <div style="position:absolute;left:72px;right:72px;top:110px;color:var(--kino-fg);
    font:700 58px var(--kino-font);letter-spacing:-0.02em">Twelve find the wall.<br>One leads it.</div>
  <div style="position:absolute;left:72px;bottom:140px;color:var(--kino-muted);
    font:600 30px var(--kino-label-font)">
    3D solve &middot; depth-sorted, perspective-projected &middot; frame ${env.frame} of ${env.durationFrames}
  </div>
</div>`;
