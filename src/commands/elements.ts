import { LAYER_SOURCE_KINDS } from "../render/layerSpec.js";
import { BLEND_MODES } from "../render/blendModes.js";
import { OVERLAY_TWEEN_PARAMS } from "../spec/schema.js";
import { emitJson, wantsJson } from "./emit.js";

// Discovery: what overlay elements an agent can lay out + tween.
//
// The catalogue is data, not print statements, so `--as json` and the human listing are the same
// facts rendered twice. The tween channel list comes straight from the validator's own constant —
// this listing physically cannot advertise a channel the spec would reject.

interface ElementDef {
  id: string;
  scope: string;
  /** The spec field carrying this element's tween track. */
  tweenField: string;
  tweenNote: string;
  /** Extra author-facing surfaces, each rendered as `label: text`. */
  extras?: { label: string; text: string }[];
}

const ELEMENTS: ElementDef[] = [
  {
    id: "caption",
    scope: "per segment",
    tweenField: "captionKeyframes",
    tweenNote: "x/y offset, % of frame",
    extras: [
      {
        label: "backplate",
        text: "brand captionStyle.background { color?, opacity?, appOnly? } — translucent panel behind lower-third captions for legibility over light app screens (opt-in; appOnly default true = app cut-ins only)",
      },
    ],
  },
  { id: "kicker", scope: "per app segment", tweenField: "kickerKeyframes", tweenNote: "x/y offset, % of frame" },
  {
    id: "zoom",
    scope: "per app segment",
    tweenField: "zoomKeyframes",
    tweenNote: "x/y focal offset, % of frame",
    extras: [
      {
        label: "about",
        text: "camera push/pan on the app footage + frame chrome group (the canvas zoom for inset device footage; captions/bg stay put)",
      },
    ],
  },
  {
    id: "layers",
    scope: "spec.layers[], one entry per declared layer",
    tweenField: "keyframes",
    tweenNote: "x/y offset, % of frame; at is relative to the layer's own start, not absolute",
    extras: [
      {
        label: "sources",
        text: `${LAYER_SOURCE_KINDS.join(", ")} — set source.kind + source.src`,
      },
      {
        label: "z",
        text: "picks paint order against the built-in stack (Z.backdrop 0 .. Z.qa 9000, src/render/layers.ts) — pick a value between two built-ins, never one of them",
      },
      { label: "blend", text: `${BLEND_MODES.join(", ")}  (default normal)  — also settable per video/motion segment` },
    ],
  },
];

const TIMEBASE =
  "Per-segment tracks (caption / kicker / zoom) use `at` = seconds from the beat's start (0 = beat start; they ride the beat when VO timing shifts).";

export async function elements(opts: { as?: string } = {}): Promise<void> {
  if (wantsJson(opts)) {
    emitJson({
      kind: "elements",
      tweenChannels: OVERLAY_TWEEN_PARAMS,
      elements: ELEMENTS.map((e) => ({
        id: e.id,
        scope: e.scope,
        tween: { field: e.tweenField, entry: "{ at, params, ease? }", channels: OVERLAY_TWEEN_PARAMS, note: e.tweenNote },
        ...(e.extras ? { extras: Object.fromEntries(e.extras.map((x) => [x.label, x.text])) } : {}),
      })),
      layerSourceKinds: LAYER_SOURCE_KINDS,
      blendModes: BLEND_MODES,
      notes: [TIMEBASE],
    });
    return;
  }

  const w = process.stdout.write.bind(process.stdout);
  const channels = OVERLAY_TWEEN_PARAMS.join(", ");
  w("Overlay elements — agent-controllable layout + tween:\n\n");
  for (const e of ELEMENTS) {
    w(`  ${e.id} (${e.scope})\n`);
    w(`    tween:     ${e.tweenField} [{ at, params: { ${channels} }, ease? }]  (${e.tweenNote})\n`);
    for (const x of e.extras ?? []) w(`    ${(x.label + ":").padEnd(10)} ${x.text}\n`);
    w("\n");
  }
  w(TIMEBASE + "\n");
}
