// geo-facade — the frame shatters into a facade of Voronoi panels, each hinged on its own axis,
// and a wave of flips sweeps across it. A panel shows the OUTGOING beat on its front face; as it
// rotates it foreshortens to a lit edge-on sliver, opening a dark slit onto the wall behind, then
// swings back out carrying the INCOMING beat on its far face. Architecture, not a wipe: every panel
// keeps its own irregular footprint and its own hinge, so the frame reads as a shattering wall.
//
//   how the shape is built
//     · a jittered-grid Voronoi partitions the frame into irregular panels (isotropic in pixels,
//       so a 9:16 frame gets tall-ish columns of roughly square cells, not smeared rectangles)
//     · each panel gets a hinge line through its site; `align` blends the hinge from per-cell
//       random (chaotic shards) toward perpendicular-to-the-sweep (coherent venetian blinds)
//     · rotation is faked exactly the way a real hinge foreshortens: the panel's footprint is
//       divided by cos(theta) across the hinge, and a fragment belongs to the panel only if that
//       un-foreshortened point still lands in the SAME Voronoi cell. Arbitrary cell shapes clip
//       themselves for free, and the panel can never spill past its own footprint. The coverage
//       test is the signed distance to the cell wall, so it antialiases analytically — a binary
//       in/out staircases hard once one screen pixel spans 1/cos of a cell.
//     · the face is lit as a flat plate: one half of the hinge swings toward the key light and the
//       other away, so it carries a ramp, and only the edge turned into the light takes the bevel
//     · a fracture web runs AHEAD of the flip wave and heals behind it, so the wall is already
//       cracking where the next panels are about to go
//
//   params (transitionParams — all optional, all NUMERIC)
//     cells    panels along the frame's height (default 7). 4 = big slabs, 14 = mosaic.
//     angle    degrees; direction the flip wave travels. 0 = along +uv.y, 90 = along +uv.x.
//     stagger  0..0.95 — share of the handoff spent waiting. 0 = the whole wall flips at once,
//              0.7 = a long travelling ripple where one edge has landed before the other starts.
//     align    0..1 hinge coherence. 0 = every panel hinges on a different random axis,
//              1 = every hinge is square to the wave, so it reads as blinds.
//
//   endpoint contract
//     Per-panel progress is clamp((uP - delay) / window, 0, 1) with delay in [0, stagger] and
//     window = 1 - stagger, so EVERY panel is at exactly 0 when uP=0 and exactly 1 when uP=1 —
//     both ends are overshot by construction, not approached. Both are then short-circuited: a
//     landed panel returns kinoTo(uv) untouched, and one that has not started returns kinoFrom(uv)
//     with only the seam applied — and the seam's opacity is crack * (1 - progress), which is
//     identically 0 at both uP=0 and uP=1. So no resampling, coverage, shading, bevel or seam math
//     can perturb an endpoint. The shading (1 - shadow*sin) and the bevel (∝ sin) independently
//     vanish at theta=0 and pi. Verified: the p=0 and p=1 stills are RMSE 0 against a straight cut.
//
//   spec: { "transition": "custom", "transitionSource": "geo-facade",
//           "transitionParams": { "cells": 7, "angle": 202, "stagger": 0.62, "align": 0.4 } }

#define KINO_PI 3.14159265359

// How far a site may wander from its grid slot. Below 1.0 so a 3x3 search is always the true
// nearest — determinism matters more here than perfectly wild cells.
#define KINO_JITTER 0.82

// Direction the key light comes from, in grid space. Drives which edge of a turning panel catches
// the bevel and which way its face ramps into shadow.
#define KINO_LIGHT normalize(vec2(-0.55, 1.0))
// Depth of the shadow a panel takes as it turns away from the light.
#define KINO_SHADOW 0.62
// Ramp across the face from the lit edge to the trailing one — what sells the tilt.
#define KINO_RAMP 0.42
// Darkness of the wall glimpsed through an open slit.
#define KINO_WALL 0.15
// Bevel highlight: width as a fraction of the panel (measured on the un-foreshortened face, so it
// stays a rim instead of swallowing a steeply-turned panel) and strength.
#define KINO_BEVEL_W 0.075
#define KINO_BEVEL_GAIN 0.85
// Fracture: how far ahead of the flip wave the wall cracks (share of a panel's delay), the seam
// width in grid units, and how dark an open seam goes.
#define KINO_CRACK_LEAD 0.45
#define KINO_CRACK_W 0.016
#define KINO_CRACK_DARK 0.10

// Deterministic 2D→2D hash (no time, no state — a pure function of the cell id).
vec2 kinoHash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

// Site of the Voronoi cell containing g, in grid space.
void kinoSite(vec2 g, out vec2 id, out vec2 pos) {
  vec2 gi = floor(g);
  float best = 1e9;
  id = gi;
  pos = gi + 0.5;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cid = gi + vec2(float(x), float(y));
      vec2 p = cid + 0.5 + (kinoHash2(cid) - 0.5) * KINO_JITTER;
      float d = dot(g - p, g - p);
      if (d < best) { best = d; id = cid; pos = p; }
    }
  }
}

// Distance from g to the nearest wall of its own cell (IQ's perpendicular-bisector metric).
float kinoBorder(vec2 g, vec2 id, vec2 site) {
  float md = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cid = id + vec2(float(x), float(y));
      if (x == 0 && y == 0) continue;
      vec2 p = cid + 0.5 + (kinoHash2(cid) - 0.5) * KINO_JITTER;
      vec2 r = p - site;
      float rl = length(r);
      if (rl < 1e-5) continue;
      md = min(md, dot(0.5 * (site + p) - g, r / rl));
    }
  }
  return md;
}

// Darkening multiplier for the fracture seam. `bd` is the distance to the cell wall in whatever
// space the caller is working in and `aa` one pixel in that space, so the same seam reads at a
// constant screen width whether the panel is flat or foreshortened. `op` gates the whole thing and
// is 0 at both ends of the handoff, so the seam can never touch an endpoint.
float kinoSeam(float bd, float aa, float grow, float op) {
  float w = KINO_CRACK_W * (0.35 + 0.65 * grow);
  float line = clamp((w - bd) / aa + 0.5, 0.0, 1.0) * op;
  return mix(1.0, KINO_CRACK_DARK, line);
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = kinoUv(fragCoord);

  // Omitted params arrive as 0.0, so every read carries its own default.
  float dens  = u_cells > 0.5 ? u_cells : 7.0;
  float stag  = u_stagger > 0.0 ? clamp(u_stagger, 0.0, 0.95) : 0.62;
  float align = clamp(u_align, 0.0, 1.0);
  float sweep = radians(u_angle);

  float ar = uRes.x / uRes.y;
  vec2 gscale = vec2(ar, 1.0) * dens;   // uv → grid space; cells stay square in pixels
  vec2 g = uv * gscale;

  vec2 id, site;
  kinoSite(g, id, site);
  vec2 rnd = kinoHash2(id + 17.0);

  // --- when does THIS panel flip -------------------------------------------------------------
  // Order the wall along the sweep direction, normalised so ord spans exactly 0..1 across the
  // frame whatever the angle, then scatter it a little so the wave is a ripple, not a ruler.
  vec2 dir = vec2(sin(sweep), cos(sweep));
  float extent = 0.5 * (abs(dir.x) + abs(dir.y));
  vec2 siteUv = site / gscale;
  float ord = 0.5 + dot(siteUv - 0.5, dir) / (2.0 * extent);
  ord = clamp(ord + (rnd.y - 0.5) * 0.22, 0.0, 1.0);

  float delay = ord * stag;                                  // in [0, stag]
  float e = clamp((uP - delay) / (1.0 - stag), 0.0, 1.0);     // exactly 0 at uP=0, 1 at uP=1
  e = smoothstep(0.0, 1.0, e);

  // The wall fractures before it moves: the same ramp on a delay pulled back toward 0, so it still
  // starts at exactly 0 when uP=0 but runs ahead of the flip. It heals as the panel lands — the
  // (1 - e) factor drives the seam to nothing by the time a panel is home.
  float crk = clamp((uP - delay * (1.0 - KINO_CRACK_LEAD)) / (1.0 - stag), 0.0, 1.0);
  crk = smoothstep(0.0, 1.0, crk);
  float crackOp = crk * (1.0 - e);

  float aaFlat = 0.8 * dens / uRes.y;   // one screen pixel, in grid units

  // Endpoint short-circuits. A landed panel is untouched kinoTo (crackOp is already 0 there), and
  // a panel that has not started is untouched kinoFrom apart from the seam — which is itself
  // scaled by crackOp, so at uP=0 it is identically zero and kinoFrom comes through bit for bit.
  if (e >= 1.0) { fragColor = kinoTo(uv); return; }
  if (e <= 0.0) {
    float shade = kinoSeam(kinoBorder(g, id, site), aaFlat, crk, crackOp);
    fragColor = vec4(kinoFrom(uv).rgb * shade, 1.0);
    return;
  }

  float theta = KINO_PI * e;
  float c = abs(cos(theta));          // foreshortening across the hinge
  float s = sin(theta);               // 0 at both ends — everything cosmetic rides on this

  // --- the hinge ------------------------------------------------------------------------------
  float randA = rnd.x * KINO_PI;                 // hinge lines are 180°-symmetric
  float wantA = sweep + KINO_PI * 0.5;           // square to the wave
  float dA = mod(wantA - randA + KINO_PI * 0.5, KINO_PI) - KINO_PI * 0.5;
  float a = randA + align * dA;
  vec2 ax = vec2(cos(a), sin(a));
  vec2 nrm = vec2(-ax.y, ax.x);

  // Un-foreshorten across the hinge. Along the hinge nothing moves, so a panel can never grow
  // past its own cell and overlap a neighbour — no depth sorting needed.
  vec2 q = g - site;
  float qa = dot(q, ax);
  float qn = dot(q, nrm);
  float cc = max(c, 0.05);
  vec2 gMask = site + ax * qa + nrm * (qn / cc);

  // Coverage: the panel owns this fragment only while its un-foreshortened point is still inside
  // the cell. Signed distance to the cell wall gives that test AND its antialiasing — a binary
  // in/out staircases badly once a panel turns, because one screen pixel then spans 1/cos of the
  // cell. Grid space is isotropic in pixels (that is why gscale carries the aspect), so a pixel is
  // dens/uRes.y grid units, widened by the same 1/cos.
  float bd = kinoBorder(gMask, id, site);
  float aa = aaFlat / cc;
  float cov = clamp(bd / aa + 0.5, 0.0, 1.0);

  // The FOOTPRINT foreshortens by cos, but sampling the content at the same rate magnifies it 20x
  // in a steep sliver and turns every panel into a smear. Sample on sqrt(cos) instead: same
  // direction of squeeze, a quarter of the violence, and still exactly identity at cos = 1.
  vec2 uvSrc = (site + ax * qa + nrm * (qn / sqrt(cc))) / gscale;
  // Past edge-on the far face is showing, and that face carries the incoming beat. The swap lands
  // where the panel is a 5%-wide sliver buried in its own shadow, so it is invisible.
  vec3 panel = (e < 0.5 ? kinoFrom(uvSrc) : kinoTo(uvSrc)).rgb;

  // A panel is a flat plate: one half of it swings toward the key light and the other away, so the
  // face takes a ramp rather than a flat wash. Every cosmetic term rides on s, which is 0 at both
  // ends of the flip, so none of them can disturb an endpoint.
  float across = clamp(dot(gMask - site, nrm) / 0.55, -1.0, 1.0);
  float faceLit = sign(dot(nrm, KINO_LIGHT));
  panel *= max(1.0 - s * (KINO_SHADOW - KINO_RAMP * across * faceLit), 0.0);

  // Bevel on the panel's own face, so it foreshortens with the panel instead of eating it — and
  // only the edge turned into the light takes the full hit.
  float lit = dot(sign(qn) * nrm, KINO_LIGHT);
  float bev = smoothstep(KINO_BEVEL_W, 0.0, bd) * s * cov;
  panel += vec3(0.42, 1.0, 0.72) * bev * KINO_BEVEL_GAIN * (0.28 + 0.72 * clamp(lit, 0.0, 1.0));

  // The seam again, in the panel's own space so it lines up with — and dissolves into — the real
  // slit as the panel turns. Continuous with the not-yet-started branch above at e=0.
  panel *= kinoSeam(bd, aa, crk, crackOp);

  // Behind the facade: the incoming beat as a wall in deep shadow, seen through the open slits.
  vec3 wall = kinoTo(uv).rgb * KINO_WALL;

  fragColor = vec4(mix(wall, panel, cov), 1.0);
}
