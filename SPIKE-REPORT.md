# Spike report: live-DOM motion OSR → pixel relay

**Verdict: feasible-with-caveats**

A second software-OSR `BrowserWindow` hosting live motion HTML can supply motion-layer pixels via `paint` → `NativeImage.toBitmap()` (BGRA) → IPC → compositor `texImage2D`, deterministically and faster than the foreignObject re-decode path — with two operational caveats (below).

Harness: `spike/osr-relay/` (`./spike/osr-relay/run.sh`). Electron **40.10.6** / Chromium 144, macOS, 1920×1080, `force-device-scale-factor=1`.

---

## Timing (n=30 each; prefer later upload run; capture varies with 1-frame lag)

Wall path per frame ≈ **paint-wait + copy + IPC + upload**.

| Stage | Run1 median / p95 (ms) | Run2 median / p95 (ms) | Notes |
|---|---|---|---|
| paint-wait (post-mutate → matched paint) | 6.2 / 13.4 | 11.0 / 13.1 | Includes 1-frame lag retry (~1–2 attempts). Single matched paint alone ≈1–2ms when already synced. |
| NativeImage→Buffer copy | 1.2 / 1.3 | 1.2 / 1.5 | `toBitmap()` + `Buffer.from` (~8.3MB) |
| IPC transfer | 6.3 / 7.0 | 6.3 / 7.0 | Main→compositor `webContents.send` of ArrayBuffer |
| texImage2D upload (+`gl.finish`) | 0.3 / 0.6 | 0.3 / 0.5 | BGRA bytes uploaded as RGBA, swizzled in shader |
| draw fullscreen | ~0 / 0.1 | ~0 / 0.1 | |

**Steady-state relay wall ≈ 15–19ms/frame** (run2-ish). FO one-shot in this harness ≈ **11ms** decode+draw — but production FO was measured at **~30–40ms/frame** with full motion markup + per-frame data-URL image re-decode. Relay wins on the production bottleneck (image re-decode); IPC of full BGRA is the new dominant cost (~6ms).

Mutate (`executeJavaScript` + 2×rAF) ≈ 3.5–5ms median — overlapping/parallelizable with prior-frame encode in a real pipeline.

---

## Determinism

Same 30-state cursor sequence run twice → **30/30 byte-identical** BGRA buffers (SHA-256).

Freshness gate: 32×32 canvas marker encodes `frameId` in RGB; paints rejected until marker matches. Typically **1 frame behind** DOM (first paint after mutate is previous state) — one extra `invalidate`+paint clears it. No caret/scrollbar/hover noise after CSS suppression (`caret-color:transparent`, no scrollbars, `animation/transition:none`).

---

## Fidelity (relay vs foreignObject, same layout + assets)

| Metric | Value |
|---|---|
| ImageMagick RMSE | `653.324 (0.00996908)` ≈ **1.0%** relative |
| Per-channel RMSE (0–255) | **2.54** |
| Max abs channel | **147** |

Diff energy concentrates on **JPEG thumbnails + sprite** (decode path / FO isolation vs live DOM), not the solid cursor. Wallpaper mostly quiet. Opaque cursor `#ff2d55` is exact in BGRA (`b=85,g=45,r=255,a=255`). Expect small AA on `border-radius` / `box-shadow`; maxAbs 147 is JPEG/FO isolation, not a layout miss.

FO in harness used `data:` URLs (required — FO cannot load `file://`); live motion used `file://` assets. Production FO also embeds data URLs, so live-DOM vs FO will never be bit-identical for photos — quantify and accept.

---

## BGRA / premultiply

- `toBitmap()` is **B,G,R,A**.
- Opaque pixels are **straight** (not premultiplied): cursor center matches CSS exactly with `a=255`.
- Compositor uploads as `RGBA`/`UNSIGNED_BYTE`, swizzles B↔R in the fragment shader. Premultiply-unpremultiply uniform left on for AA edges; opaque content unaffected.
- `capturePage()` on this machine returned **3840×2160** (2×) despite `force-device-scale-factor=1` — do **not** use it for 1:1 motion plates without an explicit scale fix. Software-OSR `paint` stayed **1920×1080**.

---

## Caveats (must handle in integration)

1. **Two concurrent software-OSR painters starve each other** on Electron 40/macOS. Motion capture with the compositor window also painting → motion paints freeze on a stale frame. Harness phases: capture motion alone, then open compositor for IPC/upload. Integration options: (a) stop compositor OSR painting while motion paints (compositor can still run GL via `executeJavaScript` without OSR present), (b) shared-texture OSR for one/both, (c) motion paint → main holds buffer → compositor reads without its own OSR paint stream.
2. **Software-OSR paint is ~1 frame behind DOM.** Gate on a content marker (or known cursor checksum), not the first `paint` after `invalidate()`. Empty paints at boot — wait for `!image.isEmpty()` / non-zero size.
3. **IPC of full 1920×1080×4 (~8.3MB) ≈ 6ms** — fine vs 30–40ms FO, but shared-texture / IOSurface handoff (already in `offscreenWindow.ts` for encode) would drop this toward zero for production.

---

## Shortest path to real integration

1. **`src/render/native/electron/offscreenWindow.ts`** — spawn a second OSR window (motion) beside the compositor slot; reuse paint arm/`invalidate` / `toBitmap` patterns. Prefer **shared texture** for motion→encode if compositor already uses it; else software bitmap + IPC only for the motion plate.
2. **`src/render/native/page/motionRaster.ts` / `bgTextures.ts`** — branch: when `KINO_MOTION_OSR=1` (or similar), skip `buildTemplate`/`rasterAt` FO for the full-frame motion layer; receive BGRA (or shared tex) from main and `texImage2D` into the existing motion texture slot. Keep FO for small non-fullscreen HTML textures if any.
3. **`src/render/native/electron/slots.ts` / seek path** — on each frame: drive motion DOM vars (same scrub CSS / beat vars as today) via `executeJavaScript` → wait marker/paint → copy/IPC → compositor upload **before** or overlapped with compositor seek. Ensure only one window is software-painting at a time (or both shared-tex).
4. **`src/render/native/electron/app.ts`** — already sets `force-device-scale-factor=1` / sRGB / ANGLE; no change required beyond an env flag to enable the motion window.

---

## Artifacts

- `spike/osr-relay/main.mjs` — harness
- `spike/osr-relay/out/metrics.json` — full numbers
- `spike/osr-relay/out/relay.png`, `foreignObject.png`, `diff.png` — fidelity trio
- Run: `./spike/osr-relay/run.sh`
