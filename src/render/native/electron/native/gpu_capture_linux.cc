// Linux: WebGL readback RGBA -> NVENC (CUDA device type) -> H.264 annex-B.
// Phase 1 has no shared-texture path: Electron hands DMA-BUF planes on Linux and CUDA cannot
// import a bare dmabuf without EGL/Vulkan interop. See the design doc.
// libcuda / libnvidia-encode are dlopen'd, never linked, so this builds and loads on a box with
// no NVIDIA driver and simply reports available() === false.
//
// Structurally this mirrors gpu_capture_win.cc: same EncoderState / g_pool / g_nextSessionId
// ownership model, same "one NvEnc session per initEncoder() id" contract. The two substitutions
// are dlopen for LoadLibraryA and NV_ENC_DEVICE_TYPE_CUDA + a CUcontext for
// NV_ENC_DEVICE_TYPE_DIRECTX + an ID3D11Device.
#include <napi.h>
#include <dlfcn.h>
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "third_party/ffnvcodec/nvEncodeAPI.h"

namespace {

// --- CUDA driver API, dlopen'd ---
// Declared locally rather than including cuda.h so this file builds on a box with no CUDA SDK.
using CUresult = int;
using CUdevice = int;
using CUcontext = void*;

struct CudaApi {
  void* mod = nullptr;
  bool ok = false;
  CUresult (*cuInit)(unsigned int) = nullptr;
  CUresult (*cuDeviceGet)(CUdevice*, int) = nullptr;
  CUresult (*cuCtxCreate)(CUcontext*, unsigned int, CUdevice) = nullptr;
  CUresult (*cuCtxDestroy)(CUcontext) = nullptr;
  CUresult (*cuMemGetInfo)(size_t*, size_t*) = nullptr;
  CUresult (*cuCtxPushCurrent)(CUcontext) = nullptr;
  CUresult (*cuCtxPopCurrent)(CUcontext*) = nullptr;
};

CudaApi& Cuda() {
  static CudaApi api;
  static std::once_flag once;
  std::call_once(once, [] {
    api.mod = dlopen("libcuda.so.1", RTLD_NOW);
    if (!api.mod) return;
    auto sym = [&](const char* n) { return dlsym(api.mod, n); };
    api.cuInit = reinterpret_cast<decltype(api.cuInit)>(sym("cuInit"));
    api.cuDeviceGet = reinterpret_cast<decltype(api.cuDeviceGet)>(sym("cuDeviceGet"));
    api.cuCtxCreate = reinterpret_cast<decltype(api.cuCtxCreate)>(sym("cuCtxCreate_v2"));
    api.cuCtxDestroy = reinterpret_cast<decltype(api.cuCtxDestroy)>(sym("cuCtxDestroy_v2"));
    api.cuMemGetInfo = reinterpret_cast<decltype(api.cuMemGetInfo)>(sym("cuMemGetInfo_v2"));
    api.cuCtxPushCurrent = reinterpret_cast<decltype(api.cuCtxPushCurrent)>(sym("cuCtxPushCurrent_v2"));
    api.cuCtxPopCurrent = reinterpret_cast<decltype(api.cuCtxPopCurrent)>(sym("cuCtxPopCurrent_v2"));
    api.ok = api.cuInit && api.cuDeviceGet && api.cuCtxCreate && api.cuMemGetInfo;
    if (api.ok && api.cuInit(0) != 0) api.ok = false;
  });
  return api;
}

// --- NVENC, dlopen'd ---
using NvEncodeAPICreateInstance_t = NVENCSTATUS(NVENCAPI*)(NV_ENCODE_API_FUNCTION_LIST*);

struct NvEncApi {
  void* mod = nullptr;
  bool ok = false;
  NV_ENCODE_API_FUNCTION_LIST fn{};
};

NvEncApi& Api() {
  static NvEncApi api;
  static std::once_flag once;
  std::call_once(once, [] {
    api.mod = dlopen("libnvidia-encode.so.1", RTLD_NOW);
    if (!api.mod) return;
    auto create = reinterpret_cast<NvEncodeAPICreateInstance_t>(
        dlsym(api.mod, "NvEncodeAPICreateInstance"));
    if (!create) return;
    api.fn = {};
    api.fn.version = NV_ENCODE_API_FUNCTION_LIST_VER;
    if (create(&api.fn) != NV_ENC_SUCCESS) return;
    api.ok = true;
  });
  return api;
}

struct EncoderState {
  CUcontext cu = nullptr;
  void* nv = nullptr;
  void* inputBuffer = nullptr;  // sysmem packed 8-bit RGB, created lazily by the encode path
  // Word format the (lazily-created) inputBuffer above was actually allocated with. Recorded at
  // creation time rather than re-derived per call so pic.bufferFmt can never drift from what the
  // buffer really is, even if a caller asks EnsureInputBuffer for a different format on a session
  // whose buffer already exists (the buffer is created once and reused for the session's life).
  NV_ENC_BUFFER_FORMAT inputFmt = NV_ENC_BUFFER_FORMAT_UNDEFINED;
  void* bitstream = nullptr;
  int width = 0;
  int height = 0;
  int fps = 30;
  int64_t frameIndex = 0;
  std::mutex encodeExclusive;
};

std::mutex g_poolMu;
std::unordered_map<int, std::shared_ptr<EncoderState>> g_pool;
int g_nextSessionId = 1;

// Last EnsureSession failure site (for JS error strings).
thread_local const char* g_nvStep = "";

std::string NvErr(NVENCSTATUS st) { return "NVENC status " + std::to_string(static_cast<int>(st)); }

// Tear an EncoderState down in reverse construction order. Called both from shutdownEncoder and
// from the initEncoder failure path — a half-open session that is dropped instead of destroyed
// burns one of the card's very small number of concurrent NVENC session slots for the life of the
// process, so a failed init must never leak one.
void DestroySession(EncoderState& enc) {
  auto& api = Api();
  if (api.ok && enc.nv) {
    if (enc.inputBuffer) {
      api.fn.nvEncDestroyInputBuffer(enc.nv, enc.inputBuffer);
      enc.inputBuffer = nullptr;
    }
    if (enc.bitstream) {
      api.fn.nvEncDestroyBitstreamBuffer(enc.nv, enc.bitstream);
      enc.bitstream = nullptr;
    }
    api.fn.nvEncDestroyEncoder(enc.nv);
  }
  enc.nv = nullptr;
  enc.inputBuffer = nullptr;
  enc.bitstream = nullptr;
  enc.frameIndex = 0;
  if (enc.cu) {
    Cuda().cuCtxDestroy(enc.cu);
    enc.cu = nullptr;
  }
}

bool CudaProbeOk() {
  auto& cu = Cuda();
  if (!cu.ok) return false;
  CUdevice dev = 0;
  return cu.cuDeviceGet(&dev, 0) == 0;
}

NVENCSTATUS EnsureSession(EncoderState& enc, int width, int height, int fps) {
  auto& cu = Cuda();
  auto& api = Api();

  // Align to NVENC macroblock requirements (the win path does the same).
  width = (width + 1) & ~1;
  height = (height + 1) & ~1;
  fps = fps > 0 ? fps : 30;

  g_nvStep = "cuCtxCreate";
  CUdevice dev = 0;
  if (cu.cuDeviceGet(&dev, 0) != 0) return NV_ENC_ERR_NO_ENCODE_DEVICE;
  if (cu.cuCtxCreate(&enc.cu, 0, dev) != 0) {
    enc.cu = nullptr;
    return NV_ENC_ERR_NO_ENCODE_DEVICE;
  }
  // cuCtxCreate leaves the new context current on this thread. Pop it: sessions are opened from
  // the JS thread, so N initEncoder() calls would otherwise stack N contexts there and later
  // out-of-order cuCtxDestroy calls would leave dangling stack entries. The encode path pushes
  // the context explicitly when it needs it.
  if (cu.cuCtxPopCurrent) cu.cuCtxPopCurrent(nullptr);

  g_nvStep = "NvEncOpenEncodeSessionEx";
  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS params{};
  params.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
  params.deviceType = NV_ENC_DEVICE_TYPE_CUDA;
  params.device = enc.cu;
  params.apiVersion = NVENCAPI_VERSION;
  NVENCSTATUS st = api.fn.nvEncOpenEncodeSessionEx(&params, &enc.nv);
  if (st != NV_ENC_SUCCESS) {
    // NVENC does not hand back a usable session handle on failure; make sure DestroySession
    // does not then call nvEncDestroyEncoder on garbage.
    enc.nv = nullptr;
    return st;
  }

  // P1-P7 presets want their config fetched via GetEncodePresetConfigEx and the same tuningInfo
  // echoed back on init; a bare zeroed NV_ENC_CONFIG would mean CONSTQP at qp 0.
  const GUID preset = NV_ENC_PRESET_P3_GUID;
  const NV_ENC_TUNING_INFO tuning = NV_ENC_TUNING_INFO_HIGH_QUALITY;
  g_nvStep = "nvEncGetEncodePresetConfigEx";
  NV_ENC_PRESET_CONFIG presetCfg{};
  presetCfg.version = NV_ENC_PRESET_CONFIG_VER;
  presetCfg.presetCfg.version = NV_ENC_CONFIG_VER;
  st = api.fn.nvEncGetEncodePresetConfigEx(enc.nv, NV_ENC_CODEC_H264_GUID, preset, tuning, &presetCfg);
  if (st != NV_ENC_SUCCESS) return st;

  g_nvStep = "nvEncInitializeEncoder";
  NV_ENC_CONFIG cfg{};
  std::memcpy(&cfg, &presetCfg.presetCfg, sizeof(cfg));
  cfg.version = NV_ENC_CONFIG_VER;
  // GOP=1 (all-intra) keeps `ffmpeg -c:v copy` remuxable and matches the Windows contract.
  cfg.gopLength = 1;
  cfg.frameIntervalP = 1;
  cfg.encodeCodecConfig.h264Config.idrPeriod = 1;
  cfg.encodeCodecConfig.h264Config.repeatSPSPPS = 1;
  cfg.encodeCodecConfig.h264Config.outputAUD = 1;

  NV_ENC_INITIALIZE_PARAMS init{};
  init.version = NV_ENC_INITIALIZE_PARAMS_VER;
  init.encodeGUID = NV_ENC_CODEC_H264_GUID;
  init.presetGUID = preset;
  init.tuningInfo = tuning;
  init.encodeWidth = static_cast<uint32_t>(width);
  init.encodeHeight = static_cast<uint32_t>(height);
  init.darWidth = static_cast<uint32_t>(width);
  init.darHeight = static_cast<uint32_t>(height);
  init.frameRateNum = static_cast<uint32_t>(fps);
  init.frameRateDen = 1;
  init.enablePTD = 1;
  init.encodeConfig = &cfg;
  st = api.fn.nvEncInitializeEncoder(enc.nv, &init);
  if (st != NV_ENC_SUCCESS) return st;

  g_nvStep = "nvEncCreateBitstreamBuffer";
  NV_ENC_CREATE_BITSTREAM_BUFFER bs{};
  bs.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
  st = api.fn.nvEncCreateBitstreamBuffer(enc.nv, &bs);
  if (st != NV_ENC_SUCCESS) return st;
  enc.bitstream = bs.bitstreamBuffer;

  enc.width = width;
  enc.height = height;
  enc.fps = fps;
  g_nvStep = "ok";
  return NV_ENC_SUCCESS;
}

// --- encode path ---
//
// NVENC takes packed 8-bit RGB straight off the wire, so there is no hand-written YUV conversion
// here: the driver does the RGB->YUV420 conversion on the encoder's own colour-conversion hardware.
//
// Byte order is the one thing that is easy to get wrong and invisible afterwards. NVENC's format
// names are *word*-ordered, not byte-ordered: NV_ENC_BUFFER_FORMAT_ARGB is a 32-bit word with B in
// the low 8 bits, which on a little-endian host is B,G,R,A *in memory*. What arrives here is
// WebGL readPixels(GL_RGBA) output, which is R,G,B,A in memory — that is
// NV_ENC_BUFFER_FORMAT_ABGR. Handing RGBA bytes to ARGB compiles, encodes, and decodes perfectly
// well; it just swaps red and blue in every frame forever.
constexpr NV_ENC_BUFFER_FORMAT kRgbaInputFmt = NV_ENC_BUFFER_FORMAT_ABGR;

// encodeBitmap() feeds Electron's bitmap capture path instead of a WebGL readback, and that path
// hands BGRA-in-memory bytes (B,G,R,A) rather than RGBA. Applying the same word-vs-byte-order rule
// above to that layout — lowest memory byte (B) goes in the word's lowest 8 bits, then G, then R,
// then A in the highest 8 bits — spells out to word name ARGB, i.e. NV_ENC_BUFFER_FORMAT_ARGB, the
// mirror image of the RGBA/ABGR pairing above (nvEncodeAPI.h's own doc comment for
// NV_ENC_BUFFER_FORMAT_ARGB confirms this literally: "a 32-bit word with B in the lowest 8 bits").
// gpu_capture_win.cc independently corroborates this: it registers its BGRA
// (DXGI_FORMAT_B8G8R8A8) input texture with exactly NV_ENC_BUFFER_FORMAT_ARGB for the same reason.
constexpr NV_ENC_BUFFER_FORMAT kBgraInputFmt = NV_ENC_BUFFER_FORMAT_ARGB;

struct EncodeOutcome {
  std::vector<uint8_t> bytes;
  const char* step = "ok";
  NVENCSTATUS status = NV_ENC_SUCCESS;
};

// The input surface is allocated on first use rather than in EnsureSession: a session that is
// opened and never fed (the VRAM probe, a demoted worker) should not hold a frame-sized surface.
bool EnsureInputBuffer(EncoderState& enc, NV_ENC_BUFFER_FORMAT fmt, NVENCSTATUS& st) {
  if (enc.inputBuffer) return true;
  NV_ENC_CREATE_INPUT_BUFFER buf{};
  buf.version = NV_ENC_CREATE_INPUT_BUFFER_VER;
  buf.width = static_cast<uint32_t>(enc.width);
  buf.height = static_cast<uint32_t>(enc.height);
  buf.bufferFmt = fmt;
  st = Api().fn.nvEncCreateInputBuffer(enc.nv, &buf);
  if (st != NV_ENC_SUCCESS) return false;
  enc.inputBuffer = buf.inputBuffer;
  enc.inputFmt = fmt;
  return true;
}

/**
 * Copy RGBA rows into the locked NVENC input surface, honouring the surface pitch (which is *not*
 * width*4 — NVENC aligns it) and WebGL's bottom-left readPixels origin. With flipY the source's
 * last row is the visual top and so becomes destination row 0. Source rows and columns that fall
 * outside a smaller destination are dropped, not scaled.
 *
 * Any destination the source does not reach is zeroed rather than left as whatever the driver's
 * allocation held. That is not hypothetical: EnsureSession rounds odd dimensions up to even, so an
 * odd-height render gives dstH == srcH + 1 and would otherwise encode one row of uninitialised
 * memory on every frame. The fills are skipped entirely in the usual exact-fit case.
 */
void CopyRgbaRows(uint8_t* dst, uint32_t pitch, const uint8_t* rgba, int srcW, int srcH, int dstW,
                  int dstH, bool flipY) {
  const int w = std::min(srcW, dstW);
  const int h = std::min(srcH, dstH);
  const size_t rowBytes = static_cast<size_t>(w) * 4;
  const size_t tailBytes = static_cast<size_t>(dstW - w) * 4;
  for (int y = 0; y < h; y++) {
    const int srcY = flipY ? (srcH - 1 - y) : y;
    const uint8_t* srcRow = rgba + static_cast<size_t>(srcY) * static_cast<size_t>(srcW) * 4;
    uint8_t* dstRow = dst + static_cast<size_t>(y) * pitch;
    std::memcpy(dstRow, srcRow, rowBytes);
    if (tailBytes) std::memset(dstRow + rowBytes, 0, tailBytes);
  }
  for (int y = h; y < dstH; y++) {
    std::memset(dst + static_cast<size_t>(y) * pitch, 0, static_cast<size_t>(dstW) * 4);
  }
}

// Shared by the RGBA readback path (encodeRgbaAsync) and the BGRA bitmap path (encodeBitmap) —
// the only difference between the two is which packed 32bpp word format the pixels are in and
// whether the source needs a Y-flip, both supplied by the caller. `fmt` only takes effect the
// first time this session's input buffer is created (EnsureInputBuffer is a no-op on later
// calls); pic.bufferFmt below always reads back enc.inputFmt so it can never disagree with what
// the buffer actually is.
EncodeOutcome EncodeFrameSync(EncoderState& enc, const uint8_t* pixels, int srcW, int srcH,
                              bool flipY, NV_ENC_BUFFER_FORMAT fmt) {
  std::lock_guard<std::mutex> exclusive(enc.encodeExclusive);
  auto& api = Api();
  auto& cu = Cuda();
  EncodeOutcome res;

  if (!enc.nv) {
    res.step = "session";
    res.status = NV_ENC_ERR_INVALID_ENCODERDEVICE;
    return res;
  }

  // NVENC calls are made against whatever CUDA context is current on the calling thread, and this
  // runs on an N-API pool thread that has none. Push/pop around the whole encode rather than
  // leaving it current: pool threads are shared between sessions.
  res.step = "cuCtxPushCurrent";
  if (cu.cuCtxPushCurrent(enc.cu) != 0) {
    res.status = NV_ENC_ERR_INVALID_DEVICE;
    return res;
  }
  struct PopCtx {
    CudaApi& cu;
    ~PopCtx() {
      CUcontext popped = nullptr;
      cu.cuCtxPopCurrent(&popped);
    }
  } popCtx{cu};

  res.step = "nvEncCreateInputBuffer";
  if (!EnsureInputBuffer(enc, fmt, res.status)) return res;

  res.step = "nvEncLockInputBuffer";
  NV_ENC_LOCK_INPUT_BUFFER lock{};
  lock.version = NV_ENC_LOCK_INPUT_BUFFER_VER;
  lock.inputBuffer = enc.inputBuffer;
  res.status = api.fn.nvEncLockInputBuffer(enc.nv, &lock);
  if (res.status != NV_ENC_SUCCESS || !lock.bufferDataPtr) {
    if (res.status == NV_ENC_SUCCESS) res.status = NV_ENC_ERR_INVALID_PTR;
    return res;
  }
  const uint32_t pitch =
      lock.pitch ? lock.pitch : static_cast<uint32_t>(enc.width) * 4;
  CopyRgbaRows(static_cast<uint8_t*>(lock.bufferDataPtr), pitch, pixels, srcW, srcH, enc.width,
               enc.height, flipY);
  res.step = "nvEncUnlockInputBuffer";
  res.status = api.fn.nvEncUnlockInputBuffer(enc.nv, enc.inputBuffer);
  if (res.status != NV_ENC_SUCCESS) return res;

  res.step = "nvEncEncodePicture";
  NV_ENC_PIC_PARAMS pic{};
  pic.version = NV_ENC_PIC_PARAMS_VER;
  pic.inputBuffer = enc.inputBuffer;
  pic.outputBitstream = enc.bitstream;
  pic.bufferFmt = enc.inputFmt;
  pic.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
  pic.inputWidth = static_cast<uint32_t>(enc.width);
  pic.inputHeight = static_cast<uint32_t>(enc.height);
  pic.inputPitch = pitch;
  pic.frameIdx = static_cast<uint32_t>(enc.frameIndex);
  pic.inputTimeStamp = static_cast<uint64_t>(enc.frameIndex);
  // Each returned buffer has to stand alone: the frame store hands them to ffmpeg out of order and
  // remuxes with `-c:v copy`. gopLength/idrPeriod already say all-intra; FORCEIDR makes it explicit
  // per picture so a preset default can never quietly reintroduce a P frame.
  pic.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR;
  enc.frameIndex++;
  res.status = api.fn.nvEncEncodePicture(enc.nv, &pic);
  // NEED_MORE_INPUT means the driver is holding frames back (lookahead / B-frames). The config is
  // all-intra so this should not happen; if a driver does it anyway, say so plainly rather than
  // flushing with EOS — EOS ends the stream and every later frame on this session would fail.
  if (res.status != NV_ENC_SUCCESS) return res;

  res.step = "nvEncLockBitstream";
  NV_ENC_LOCK_BITSTREAM bs{};
  bs.version = NV_ENC_LOCK_BITSTREAM_VER;
  bs.outputBitstream = enc.bitstream;
  bs.doNotWait = 0;
  res.status = api.fn.nvEncLockBitstream(enc.nv, &bs);
  if (res.status != NV_ENC_SUCCESS) return res;
  if (bs.bitstreamBufferPtr && bs.bitstreamSizeInBytes > 0) {
    const uint8_t* p = static_cast<const uint8_t*>(bs.bitstreamBufferPtr);
    res.bytes.assign(p, p + bs.bitstreamSizeInBytes);
  }
  api.fn.nvEncUnlockBitstream(enc.nv, enc.bitstream);
  res.step = "ok";
  return res;
}

class RgbaWorker : public Napi::AsyncWorker {
 public:
  RgbaWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::shared_ptr<EncoderState> enc,
             std::vector<uint8_t> rgba, int w, int h, bool flipY)
      : Napi::AsyncWorker(env),
        deferred_(deferred),
        enc_(std::move(enc)),
        rgba_(std::move(rgba)),
        w_(w),
        h_(h),
        flipY_(flipY) {}

  void Execute() override {
    EncodeOutcome res = EncodeFrameSync(*enc_, rgba_.data(), w_, h_, flipY_, kRgbaInputFmt);
    out_ = std::move(res.bytes);
    if (out_.empty()) {
      // A rejection here fails the frame and, in practice, the whole render — so name the exact
      // NVENC call and status rather than making the next person bisect the encode path.
      SetError(std::string("NVENC rgba encode produced no bitstream (") + res.step + ": " +
               NvErr(res.status) + ")");
    }
  }
  void OnOK() override {
    deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(Env(), out_.data(), out_.size()));
  }
  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<EncoderState> enc_;
  std::vector<uint8_t> rgba_, out_;
  int w_, h_;
  bool flipY_;
};

Napi::Value EncodeRgbaAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsBuffer() || !info[2].IsNumber() ||
      !info[3].IsNumber()) {
    Napi::TypeError::New(env, "encodeRgbaAsync(sessionId, rgba, width, height[, flipY[, outW, outH]])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::shared_ptr<EncoderState> enc;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    auto it = g_pool.find(info[0].As<Napi::Number>().Int32Value());
    if (it == g_pool.end()) {
      Napi::Error::New(env, "encodeRgbaAsync: invalid or shut-down sessionId")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    enc = it->second;
  }
  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  const int w = info[2].As<Napi::Number>().Int32Value();
  const int h = info[3].As<Napi::Number>().Int32Value();
  // The mac/win signature defaults flipY to true when the argument is absent; match it so a caller
  // that omits it does not get silently mirrored output on one platform only.
  const bool flipY = info.Length() < 5 || !info[4].IsBoolean() || info[4].As<Napi::Boolean>().Value();
  // outW/outH (args 5,6) are deliberately unread: the session is already sized to them by
  // ensureEncoder(), and CopyRgbaRows crops to enc.width/enc.height.
  if (w <= 0 || h <= 0) {
    Napi::Error::New(env, "encodeRgbaAsync: width and height must be positive")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const size_t need = static_cast<size_t>(w) * static_cast<size_t>(h) * 4;
  if (buf.Length() < need) {
    Napi::Error::New(env, "encodeRgbaAsync: buffer too small for RGBA frame")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // Copy: the worker outlives this call and the JS Buffer may be reused for the next readback.
  std::vector<uint8_t> copy(buf.Data(), buf.Data() + need);
  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new RgbaWorker(env, deferred, std::move(enc), std::move(copy), w, h, flipY);
  worker->Queue();
  return deferred.Promise();
}

// Electron's bitmap capture path (nativeImage off a paint event): synchronous, unlike
// encodeRgbaAsync, because the interface promises callers a Buffer straight back rather than a
// Promise — this runs on the JS thread and briefly takes enc->encodeExclusive.
Napi::Value EncodeBitmap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsBuffer() || !info[2].IsNumber() ||
      !info[3].IsNumber()) {
    Napi::TypeError::New(env, "encodeBitmap(sessionId, bgra, w, h, outW?, outH?)")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  std::shared_ptr<EncoderState> enc;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    auto it = g_pool.find(info[0].As<Napi::Number>().Int32Value());
    if (it == g_pool.end()) {
      Napi::Error::New(env, "encodeBitmap: invalid or shut-down sessionId")
          .ThrowAsJavaScriptException();
      return env.Null();
    }
    enc = it->second;
  }
  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  const int w = info[2].As<Napi::Number>().Int32Value();
  const int h = info[3].As<Napi::Number>().Int32Value();
  if (w <= 0 || h <= 0) {
    Napi::Error::New(env, "encodeBitmap: width and height must be positive")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  const size_t need = static_cast<size_t>(w) * static_cast<size_t>(h) * 4;
  if (buf.Length() < need) {
    Napi::Error::New(env, "encodeBitmap: buffer too small for BGRA frame")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  // outW/outH (args 4,5) are deliberately unread, same as encodeRgbaAsync: the session is already
  // sized by initEncoder(), and CopyRgbaRows crops to enc.width/enc.height.
  //
  // Electron's bitmap path is already top-down, unlike WebGL's bottom-left readPixels origin — no
  // flip. Format is kBgraInputFmt (NV_ENC_BUFFER_FORMAT_ARGB), not kRgbaInputFmt: see the comment
  // on kBgraInputFmt above for why BGRA-in-memory input needs the *other* NVENC word format.
  EncodeOutcome res = EncodeFrameSync(*enc, buf.Data(), w, h, /*flipY=*/false, kBgraInputFmt);
  if (res.bytes.empty()) {
    Napi::Error::New(env, std::string("NVENC bitmap encode produced no bitstream (") + res.step +
                          ": " + NvErr(res.status) + ")")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Buffer<uint8_t>::Copy(env, res.bytes.data(), res.bytes.size());
}

Napi::Value NotImplemented(const Napi::CallbackInfo& info) {
  Napi::Error::New(info.Env(),
                   "encodeSharedTexture is not implemented on linux (phase 1) — use readback")
      .ThrowAsJavaScriptException();
  return info.Env().Null();
}

Napi::Value Available(const Napi::CallbackInfo& info) {
  // Must never throw: a driverless box relies on a false here to degrade the render to `direct`.
  return Napi::Boolean::New(info.Env(), Api().ok && CudaProbeOk());
}

Napi::Value InitEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
    Napi::TypeError::New(env, "initEncoder(width, height, fps) -> sessionId")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!Api().ok) {
    Napi::Error::New(env, "libnvidia-encode.so.1 unavailable").ThrowAsJavaScriptException();
    return env.Null();
  }
  if (!CudaProbeOk()) {
    Napi::Error::New(env, "libcuda.so.1 unavailable or no CUDA device")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  auto enc = std::make_shared<EncoderState>();
  NVENCSTATUS st = EnsureSession(*enc, info[0].As<Napi::Number>().Int32Value(),
                                 info[1].As<Napi::Number>().Int32Value(),
                                 info[2].As<Napi::Number>().Int32Value());
  if (st != NV_ENC_SUCCESS) {
    const char* step = g_nvStep;
    DestroySession(*enc);
    // Consumer GeForce drivers cap concurrent sessions. There is no API to query the cap, so
    // this is where it surfaces — name it, because it is the most likely failure on a cheap
    // rented box and looks nothing like a bug from the JS side.
    //
    // Measured on an RTX 3060 Ti / driver 580.82.09: the cap is 8, and the 9th
    // nvEncOpenEncodeSessionEx returns NV_ENC_ERR_INCOMPATIBLE_CLIENT_KEY (21) — *not* the
    // NV_ENC_ERR_OUT_OF_MEMORY older drivers are reported to give. It is a licence-key refusal,
    // not memory pressure: the ceiling is 8 whether the sessions are 256x256 or 3840x2160, on a
    // card with 8 GiB free. Match all three statuses so the hint survives a driver change in
    // either direction.
    const std::string hint =
        (st == NV_ENC_ERR_INCOMPATIBLE_CLIENT_KEY || st == NV_ENC_ERR_OUT_OF_MEMORY ||
         st == NV_ENC_ERR_NO_ENCODE_DEVICE)
            ? " — consumer NVIDIA cards cap concurrent NVENC sessions (3-8 depending on driver); "
              "lower KINO_CONCURRENCY or set KINO_NVENC_SESSIONS"
            : "";
    Napi::Error::New(env, std::string("NVENC init failed at ") + step + ": " + NvErr(st) + hint)
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::lock_guard<std::mutex> lock(g_poolMu);
  const int id = g_nextSessionId++;
  g_pool[id] = enc;
  return Napi::Number::New(env, id);
}

Napi::Value ShutdownEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "shutdownEncoder(sessionId)").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::shared_ptr<EncoderState> owned;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    auto it = g_pool.find(info[0].As<Napi::Number>().Int32Value());
    if (it == g_pool.end()) return env.Undefined();
    owned = std::move(it->second);
    g_pool.erase(it);
  }
  std::lock_guard<std::mutex> exclusive(owned->encodeExclusive);
  DestroySession(*owned);
  return env.Undefined();
}

// Free/total VRAM for the worker cap (workerCap.ts) to size the render's concurrency against,
// probed independently of any encoder session — this opens and immediately tears down its own
// throwaway CUDA context rather than reusing a pooled session's, so it works even before any
// initEncoder() call and reports the card's steady-state headroom rather than one session's view
// of it. Never throws: an absent/broken CUDA driver just reports zero, matching available()'s
// "must never throw" contract so a driverless box can still probe harmlessly.
Napi::Value GpuLimits(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  Napi::Object out = Napi::Object::New(env);
  auto& cu = Cuda();
  size_t freeB = 0, totalB = 0;
  if (cu.ok && CudaProbeOk()) {
    CUdevice dev = 0;
    CUcontext ctx = nullptr;
    if (cu.cuDeviceGet(&dev, 0) == 0 && cu.cuCtxCreate(&ctx, 0, dev) == 0) {
      cu.cuMemGetInfo(&freeB, &totalB);
      cu.cuCtxDestroy(ctx);
    }
  }
  out.Set("vramFreeBytes", Napi::Number::New(env, static_cast<double>(freeB)));
  out.Set("vramTotalBytes", Napi::Number::New(env, static_cast<double>(totalB)));
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("initEncoder", Napi::Function::New(env, InitEncoder));
  exports.Set("encodeSharedTexture", Napi::Function::New(env, NotImplemented));
  exports.Set("encodeSharedTextureAsync", Napi::Function::New(env, NotImplemented));
  exports.Set("encodeRgbaAsync", Napi::Function::New(env, EncodeRgbaAsync));
  exports.Set("encodeBitmap", Napi::Function::New(env, EncodeBitmap));
  exports.Set("gpuLimits", Napi::Function::New(env, GpuLimits));
  exports.Set("shutdownEncoder", Napi::Function::New(env, ShutdownEncoder));
  return exports;
}

}  // namespace

NODE_API_MODULE(gpu_capture, Init)
