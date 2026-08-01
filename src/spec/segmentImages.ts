import type { Spec } from "./schema.js";
import { DRIVE_CHANNELS, validateDriveExpr } from "../render/driveExpr.js";
import { defaultInlineSvgRel, validateInlineSvg } from "../media/imageAsset.js";

/** Sugar: extra images composited on one video/motion beat. Expanded to spec.layers[] at resolve time. */
export type SegmentImage = {
  /** Project asset path (.png/.jpg/.webp/.svg). Omit when `svg` is inline markup. */
  src?: string;
  /** Inline SVG markup — staged to assets/generated at build. Mutually exclusive with using both. */
  svg?: string;
  id?: string;
  rect?: { x: number; y: number; w: number; h: number };
  opacity?: number;
  flipX?: boolean;
  flipY?: boolean;
  blend?: "normal" | "screen" | "multiply" | "add";
  z?: number;
  keyframes?: { at: number; params: Record<string, number | string>; ease?: string }[];
  /** Beat-local math expressions — additive offset on keyframed channels. Vars: t, p, dur, pi, tau, seed. */
  drive?: Record<string, string>;
};

const SEG_IMG_Z_BASE = 301;

type SegWithImages = { images?: SegmentImage[]; kind?: string };

function expandImage(segIdx: number, img: SegmentImage, i: number, seen: Set<string>) {
  const id = img.id ?? `seg${segIdx}-img${i}`;
  if (seen.has(id)) throw new Error(`segments[${segIdx}].images[${i}]: duplicate id "${id}"`);
  seen.add(id);
  if (!img.src && !img.svg) {
    throw new Error(`segments[${segIdx}].images[${i}]: needs src (file path) or svg (inline markup)`);
  }
  if (img.svg) {
    const err = validateInlineSvg(img.svg);
    if (err) throw new Error(`segments[${segIdx}].images[${i}].svg: ${err}`);
  }
  for (const [ch, expr] of Object.entries(img.drive ?? {})) {
    if (!(DRIVE_CHANNELS as readonly string[]).includes(ch)) {
      throw new Error(`segments[${segIdx}].images[${i}].drive.${ch}: unknown channel`);
    }
    const err = validateDriveExpr(expr);
    if (err) throw new Error(`segments[${segIdx}].images[${i}].drive.${ch}: ${err}`);
  }
  const src = img.src ?? (img.svg ? defaultInlineSvgRel(id) : "");
  return {
    id,
    z: img.z ?? SEG_IMG_Z_BASE + i,
    segment: segIdx,
    source: {
      kind: "image" as const,
      src,
      ...(img.svg ? { svg: img.svg } : {}),
    },
    ...(img.rect ? { rect: img.rect } : {}),
    ...(img.opacity !== undefined ? { opacity: img.opacity } : {}),
    ...(img.flipX ? { flipX: true } : {}),
    ...(img.flipY ? { flipY: true } : {}),
    ...(img.blend ? { blend: img.blend } : {}),
    ...(img.keyframes?.length ? { keyframes: img.keyframes } : {}),
    ...(img.drive ? { drive: img.drive } : {}),
  };
}

/** Expand segment `images[]` sugar into declared layers. Idempotent. */
export function resolveSpec(spec: Spec): Spec {
  const layers = [...((spec as { layers?: unknown[] }).layers ?? [])];
  const seen = new Set(layers.map((l) => (l as { id?: string }).id).filter(Boolean) as string[]);
  let changed = false;

  const segments = spec.segments.map((seg, segIdx) => {
    const imgs = (seg as SegWithImages).images;
    if (!imgs?.length) return seg;
    if (seg.kind !== "video" && seg.kind !== "motion") {
      throw new Error(`segments[${segIdx}].images: only video/motion beats support extra images`);
    }
    for (let i = 0; i < imgs.length; i++) {
      layers.push(expandImage(segIdx, imgs[i], i, seen));
      changed = true;
    }
    const { images: _drop, ...rest } = seg as SegWithImages & Record<string, unknown>;
    return rest as typeof seg;
  });

  if (!changed) return spec;
  return { ...spec, layers: layers as Spec["layers"], segments };
}

export function validateSegmentImages(spec: Spec): string[] {
  const errs: string[] = [];
  spec.segments.forEach((seg, segIdx) => {
    const imgs = (seg as SegWithImages).images;
    if (!imgs?.length) return;
    if (seg.kind !== "video" && seg.kind !== "motion") {
      errs.push(`segments[${segIdx}].images: only video/motion beats support extra images`);
      return;
    }
    const ids = new Set<string>();
    imgs.forEach((img, i) => {
      const id = img.id ?? `seg${segIdx}-img${i}`;
      if (ids.has(id)) errs.push(`segments[${segIdx}].images[${i}]: duplicate id "${id}"`);
      ids.add(id);
      if (!img.src && !img.svg) errs.push(`segments[${segIdx}].images[${i}]: needs src or svg`);
      if (img.svg) {
        const err = validateInlineSvg(img.svg);
        if (err) errs.push(`segments[${segIdx}].images[${i}].svg: ${err}`);
      }
      for (const [ch, expr] of Object.entries(img.drive ?? {})) {
        if (!(DRIVE_CHANNELS as readonly string[]).includes(ch)) {
          errs.push(`segments[${segIdx}].images[${i}].drive.${ch}: unknown channel`);
          continue;
        }
        const err = validateDriveExpr(expr);
        if (err) errs.push(`segments[${segIdx}].images[${i}].drive.${ch}: ${err}`);
      }
    });
  });
  return errs;
}
