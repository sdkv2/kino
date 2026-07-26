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

- [x] `KINO_ELECTRON_CAPTURE=shared` on Windows NVIDIA box produces valid H.264 annex-B and remuxes to mp4
  - Proven 2026-07-26 on RTX 3050 Laptop: `glass-helix-win-shared-9x16.mp4` (1080×1920, 115f)
  - After per-session D3D: c1 ~19.4 / c2 ~33.8 / c3 ~44.3 ms/frame wall; `gpu-shared` ~17.7 / 19.6 / 23.4 ms
- [ ] macOS path still green (`test:light` + glass-helix shared) — unchanged on this machine
- [x] Profile shows NVENC encode cost (`gpu-shared`), not JPEG readback
- [x] `KINO_CONCURRENCY=2` (and c=3) with one Electron host + multi-session; per-session D3D11 device/context (no global GPU lock)

## Windows ops notes

- **Do not bench over SSH Session 0.** GPU process dies (`exit_code=34`). Run in the interactive Console session (scheduled task `/IT`, or local Cursor/terminal).
- **stdin broken under Electron+spawn on win32** — parent uses TCP (`KINO_ELECTRON_CMD_PORT`); replies still on stdout.
- **DuplicateHandle** the OSR `ntHandle` before `tex.release()` (async encode).
- Vendored NVENC header: `n12.2.72.0` (API 12.2). VS 18 needs node-gyp patch (applied in `build-gpu-capture.mjs`).
- Launch helper on the box: `powershell -File C:\Users\aiden\kino\launch-kino-bench.ps1`
