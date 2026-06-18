// Tier-3 Lottie support: parse + validate + lint + playback math for embedded Bodymovin (.json)
// animations. fs-free and pure (deterministic) so it runs node-side (resolveMotionGraphic) AND in the
// Remotion bundle (MotionGraphic.tsx). See docs/superpowers/specs/2026-06-19-lottie-tier3-design.md.

export type LottieData = Record<string, unknown>;

export const LOTTIE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB; the JSON ships inline in Remotion inputProps

// Parse a Lottie JSON string and validate it is a Bodymovin doc with a determinable duration.
// Throws friendly errors (caught by resolveMotionGraphic and surfaced to the agent).
export function parseLottie(raw: string): { data: LottieData } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("not valid JSON");
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("not a Lottie animation (expected a JSON object)");
  }
  const d = data as Record<string, unknown>;
  const ok =
    typeof d.v === "string" &&
    typeof d.w === "number" &&
    typeof d.h === "number" &&
    typeof d.fr === "number" &&
    typeof d.ip === "number" &&
    typeof d.op === "number" &&
    Array.isArray(d.layers);
  if (!ok) {
    throw new Error("not a Lottie animation (expected Bodymovin JSON with v/w/h/fr/ip/op/layers)");
  }
  if (!((d.op as number) > (d.ip as number)) || !((d.fr as number) > 0)) {
    throw new Error("Lottie has no determinable duration (op must exceed ip, fr must be > 0)");
  }
  return { data: d };
}

// Full recursive walk: collect determinism/safety flags from every object/array node so we reach
// ks/transforms, effect values, text animators, masks, time-remap, and nested precomp layers.
function scan(node: unknown, flags: { expression: boolean; slotRef: boolean }): void {
  if (Array.isArray(node)) {
    for (const item of node) scan(item, flags);
    return;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    // An AE expression stores the JS source as a STRING in `x`. A split-dimension channel or mask
    // feather also uses key `x`, but its value is an object/array — so gate on typeof === "string".
    if (typeof obj.x === "string") flags.expression = true;
    if ("sid" in obj) flags.slotRef = true;
    for (const value of Object.values(obj)) scan(value, flags);
  }
}

// Determinism + safety violations (empty = clean). Same contract as lintMotionHtml/lintMotionJs.
export function lintLottie(data: LottieData): string[] {
  const v: string[] = [];
  const flags = { expression: false, slotRef: false };
  scan(data, flags);

  if (flags.expression) {
    v.push(
      "After Effects expressions aren't allowed — they evaluate JS at render time (non-deterministic + an eval surface). Re-export with expressions baked/removed.",
    );
  }
  if ("slots" in data || flags.slotRef) {
    v.push("Lottie slots (data-driven theming indirection) aren't supported — flatten the values into the animation.");
  }

  // Fonts: anything not embedded as a data: font is a host-dependent fallback risk. We treat only a
  // `data:` fPath as embedded; fonts marked embedded another way (e.g. origin:3 + a CSS fClass) are
  // over-rejected. That's the intended safe direction — a false positive (annoying) over a false
  // negative (a system font slipping through = a silent cross-machine determinism hole).
  const fonts = (data as Record<string, unknown>).fonts as { list?: unknown[] } | undefined;
  if (fonts && Array.isArray(fonts.list) && fonts.list.length > 0) {
    const anyExternal = fonts.list.some((f) => {
      const fPath = (f as Record<string, unknown>)?.fPath;
      return !(typeof fPath === "string" && fPath.startsWith("data:"));
    });
    if (anyExternal) {
      v.push(
        "external/system fonts aren't allowed — headless Chromium has no guaranteed fonts, so text would render with a host-dependent fallback (non-deterministic). Outline text to shapes, or embed the font.",
      );
    }
  }

  // Image assets: an image asset has `p` (filename or data URI) and no `layers` (which would make it a precomp).
  const assets = (data as Record<string, unknown>).assets;
  if (Array.isArray(assets)) {
    let pushedExternal = false;
    let pushedSvg = false;
    for (const a of assets) {
      if (!a || typeof a !== "object") continue;
      const entry = a as Record<string, unknown>;
      if ("layers" in entry) continue; // precomp, not an image
      if (!("p" in entry)) continue; // not an image asset
      const p = String(entry.p ?? "");
      const embedded = entry.e === 1 && p.startsWith("data:");
      if (!embedded && !pushedExternal) {
        v.push("external asset refs don't resolve during render — embed images in the export (base64 data: URI), or remove them.");
        pushedExternal = true;
      } else if (embedded && /^data:image\/svg\+xml/i.test(p) && !pushedSvg) {
        v.push("embedded SVG image payloads aren't allowed — they bypass HTML sanitization and can carry script. Rasterize to PNG/JPEG, or remove.");
        pushedSvg = true;
      }
    }
  }

  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > LOTTIE_MAX_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1);
    v.push(`Lottie is too large (${mb} MB > 3 MB) — it ships inline in the render inputProps. Simplify or split the animation.`);
  }

  return v;
}

// Non-fatal warnings (logged, not thrown). A full-frame opaque solid is fine for a kind:"motion" beat
// but occludes the avatar/app when the same graphic is used as a motionOverlay.
export function warnLottie(data: LottieData): string[] {
  const w: string[] = [];
  const W = Number((data as Record<string, unknown>).w);
  const H = Number((data as Record<string, unknown>).h);
  const layers = (data as Record<string, unknown>).layers;
  if (Array.isArray(layers)) {
    const opaqueFullFrameSolid = layers.some((l) => {
      if (!l || typeof l !== "object") return false;
      const layer = l as Record<string, any>;
      if (layer.ty !== 1) return false; // solid layer
      const full = Number(layer.sw) >= W && Number(layer.sh) >= H;
      const o = layer.ks?.o;
      // Static full opacity: { a:0, k:100 } (or k:[100]); animated opacity → don't warn (best-effort).
      const opaque = o && o.a === 0 && (o.k === 100 || (Array.isArray(o.k) && o.k[0] === 100));
      return full && opaque;
    });
    if (opaqueFullFrameSolid) {
      w.push(
        'opaque background detected — fine for kind:"motion", but as a motionOverlay this will hide the underlying video. Use a transparent-background export.',
      );
    }
  }
  return w;
}

// playbackRate to stretch a Lottie's full duration across the beat exactly once.
// Docs (remotion.dev/docs/lottie/lottie): playbackRate is "the speed of the animation; a higher number
// is faster". So rate = naturalSeconds / beatSeconds (slow down for a longer beat). Computed in SECONDS
// so a non-composition-fps asset isn't mis-scaled. Returns 1 when looping or when inputs are degenerate.
export function lottiePlaybackRate(
  durationInSeconds: number,
  beatFrames: number,
  fps: number,
  loop: boolean,
): number {
  if (loop) return 1;
  const beatSeconds = beatFrames / fps;
  if (!(durationInSeconds > 0) || !(beatSeconds > 0)) return 1;
  return durationInSeconds / beatSeconds;
}
