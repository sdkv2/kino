# Handoff: Electron OSR capture → Windows (DXGI + NVENC)

Branch: `feat/electron-offscreen-capture`
Package root: `kino/` (this repo). Prefer the worktree that tracks this branch.

## Goal

Port the macOS Electron shared-texture capture path to **Windows**:

`OSR paint → DXGI shared handle → NVENC H.264 annex-B → ffmpeg remux`

CUDA is optional glue only. Chromium gives a **DXGI/D3D11** handle on Windows, not a CUDA buffer. Prefer **D3D11 → NVENC**. Use CUDA↔D3D interop only if NVENC setup requires it.

Linux is out of scope for this handoff (dma-buf + VAAPI/NVENC later).

## What’s already done (macOS)

- Electron offscreen renderer (`KINO_RENDERER=electron`)
- Capture modes via `KINO_ELECTRON_CAPTURE`:
  - `shared` (default/`auto` when native addon exists): paint → IOSurface → VideoToolbox
  - `readback`: WebGL `readPixels` → IPC → VT (slower)
  - `direct`: WebCodecs in-page (OpenH264 on Electron — slower; keep as opt-in)
  - `page`: `capturePage` JPEG
- **One Electron process, N offscreen windows** (`slots.ts` + `worker.ts`) — tagged IPC
- **Multi-session VT** (`initEncoder()` → `sessionId`; encode/shutdown take id)
- Stills use sync capture (`shot()` must not use pipelined canvas capture)
- Early invalidate: page `kinoElectron.frameReady` → main `invalidate()` before `executeJavaScript` returns
- Chromium GPU flags in `electron/app.ts` (ANGLE/Metal on mac; Windows should use `d3d11`)

### Measured floor (M-series Mac, glass-helix mock 9:16, 114f, `KINO_NO_FRAME_CACHE=1`)

| path | frames | notes |
|------|--------|-------|
| Electron `shared` | ~2.5s (~18–22 ms/f) | paint-wait ~16 ms = FrameSink **CopyOutput** |
| Puppeteer JPEG sync | ~4.5s | slower |
| Electron `direct` WebCodecs | ~5.4s | software OpenH264 |

**Do not fight CopyOutput** without a Chromium change. Same present tax will exist on Windows. Win by implementing DXGI→NVENC parity with mac VT path.

## Key files

| Path | Role |
|------|------|
| `src/render/native/electron/slots.ts` | Parent ↔ one Electron host, tagged IPC |
| `src/render/native/electron/worker.ts` | Multi-window command loop |
| `src/render/native/electron/offscreenWindow.ts` | Boot, paint, encode pipeline |
| `src/render/native/electron/gpuCapture.ts` | Mode resolve + native load |
| `src/render/native/electron/native/gpu_capture.mm` | macOS VT (reference) |
| `src/render/native/electron/preload.cjs` | `pushFrame` / `pushH264` / `frameReady` |
| `src/render/native/electron/app.ts` | Chromium switches before `ready` |
| `src/render/native/engine.ts` | Concurrency, stills sync, capture log lines |
| `scripts/build-page.mjs` | Copies `preload.cjs` into `dist/` |

## Windows implementation checklist

1. **Native addon (non-Apple)**
   - Replace `#else Unavailable` stub in `gpu_capture` with a Windows `.cc`/`.cu` target (or separate `gpu_capture_win.cc`).
   - API must stay: `initEncoder → sessionId`, `encodeSharedTexture(Async)`, `encodeRgbaAsync`, `encodeBitmap`, `shutdownEncoder(sessionId)`.
   - Open Electron’s shared handle as `ID3D11Texture2D` (`OpenSharedResource` / `OpenSharedResource1`).
   - Encode with **NVENC** (Video Codec SDK) to annex-B all-intra (or GOP=1) so ffmpeg `-c:v copy` still works.
   - Multi-session: one NVENC encoder (or context) per `sessionId`, like VT pool.

2. **Build**
   - Extend `scripts/build-gpu-capture.mjs` / `binding.gyp` for `win32` + CUDA toolkit / Video Codec SDK paths.
   - Rebuild against **Electron’s Node ABI** (same as mac `build:native`).

3. **Electron flags (`app.ts`)**
   - Keep `use-angle=d3d11` on win32 (already branched).
   - Verify OSR `useSharedTexture: true` yields a non-empty `textureInfo.handle` on Windows.

4. **JS wiring**
   - `sharedTextureCaptureAvailable()` / `resolveElectronCapture()` should return `shared` when the Windows `.node` exists.
   - Handle layout: confirm whether Windows buffer is an NT `HANDLE` pointer in a Node `Buffer` (see Electron `OffscreenSharedTexture` docs + OSR README).

5. **Bench**
   - Same workload: `projects/shader-demo/specs/glass-helix.json --mock --format 9:16`
   - `KINO_RENDERER=electron KINO_ELECTRON_CAPTURE=shared KINO_NO_FRAME_CACHE=1 KINO_CONCURRENCY=1|2 KINO_PROFILE=1`
   - Compare vs Puppeteer JPEG sync (`KINO_CAPTURE_CODEC=jpeg KINO_CAPTURE_PIPELINE=0`).
   - Expect paint-wait to dominate; NVENC should be in the same ballpark as VT (~5–10 ms/f) if the path is right.

6. **Do not**
   - Fork Chromium to remove CopyOutput.
   - Default to `direct` WebCodecs unless HW encode is proven faster than shared+NVENC.
   - Commit `native/build/` artifacts.
   - Break macOS VT path.

## Smoke commands

```bash
npm run build && npm run build:native
npm run test:light
KINO_RENDERER=electron KINO_ELECTRON_CAPTURE=shared KINO_NO_FRAME_CACHE=1 KINO_PROFILE=1 \
  node dist/cli.js build projects/shader-demo/specs/glass-helix.json --mock --format 9:16 --tag win-shared
```

## Success criteria

- [ ] `KINO_ELECTRON_CAPTURE=shared` on Windows NVIDIA box produces valid H.264 annex-B and remuxes to mp4
- [ ] macOS path still green (`test:light` + glass-helix shared)
- [ ] Profile shows NVENC encode cost, not a full CPU readback
- [ ] `KINO_CONCURRENCY=2` works with one Electron host + two sessions (no DXGI/NVENC races)
