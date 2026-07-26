// Windows: DXGI/D3D11 shared texture (Electron OSR ntHandle) → NVENC H.264 annex-B.
// Multi-session: each initEncoder() returns a session id (one NvEnc session each).
// CUDA optional — Chromium hands DXGI handles; encode is D3D11 → NVENC.
#include <napi.h>

#ifndef _WIN32
#error "gpu_capture_win.cc is Windows-only"
#endif

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <d3d11.h>
#include <d3d11_1.h>
#include <dxgi.h>
#include <wrl/client.h>

#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "third_party/ffnvcodec/nvEncodeAPI.h"

using Microsoft::WRL::ComPtr;

namespace {

using NvEncodeAPICreateInstance_t = NVENCSTATUS(NVENCAPI*)(NV_ENCODE_API_FUNCTION_LIST*);

struct NvEncApi {
  HMODULE mod = nullptr;
  NV_ENCODE_API_FUNCTION_LIST fn{};
  bool ok = false;
};

NvEncApi& Api() {
  static NvEncApi api;
  static std::once_flag once;
  std::call_once(once, [] {
    api.mod = LoadLibraryA("nvEncodeAPI64.dll");
    if (!api.mod) return;
    auto create = reinterpret_cast<NvEncodeAPICreateInstance_t>(
        GetProcAddress(api.mod, "NvEncodeAPICreateInstance"));
    if (!create) return;
    api.fn = {NV_ENCODE_API_FUNCTION_LIST_VER};
    if (create(&api.fn) != NV_ENC_SUCCESS) return;
    api.ok = true;
  });
  return api;
}

// One adapter pick for the process; each EncoderState owns its own device+immediate context
// so concurrent sessions don't serialize on a shared ID3D11DeviceContext.
static ComPtr<IDXGIAdapter> NvidiaAdapter() {
  static ComPtr<IDXGIAdapter> chosen;
  static std::once_flag once;
  std::call_once(once, [] {
    ComPtr<IDXGIFactory1> factory;
    if (FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return;
    for (UINT i = 0;; i++) {
      ComPtr<IDXGIAdapter> adapter;
      if (factory->EnumAdapters(i, &adapter) == DXGI_ERROR_NOT_FOUND) break;
      DXGI_ADAPTER_DESC desc{};
      if (FAILED(adapter->GetDesc(&desc))) continue;
      if (desc.VendorId == 0x10DE) {  // NVIDIA
        chosen = adapter;
        return;
      }
      if (!chosen) chosen = adapter;
    }
  });
  return chosen;
}

struct EncoderState {
  ComPtr<ID3D11Device> device;
  ComPtr<ID3D11Device1> device1;
  ComPtr<ID3D11DeviceContext> ctx;
  void* nv = nullptr;
  ComPtr<ID3D11Texture2D> inputTex;
  void* registeredResource = nullptr;
  void* inputBuffer = nullptr;  // sysmem NV12 (bitmap / RGBA / staging fallback)
  void* bitstream = nullptr;
  int width = 0;
  int height = 0;
  int fps = 30;
  int64_t frameIndex = 0;
  int enablePtd = 0;
  std::mutex encodeExclusive;
};

std::mutex g_poolMu;
std::unordered_map<int, std::shared_ptr<EncoderState>> g_pool;
int g_nextSessionId = 1;

static bool EnsureD3D(EncoderState& enc) {
  if (enc.device && enc.device1 && enc.ctx) return true;
  auto adapter = NvidiaAdapter();
  if (!adapter) return false;
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL flOut{};
  const D3D_FEATURE_LEVEL fls[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
  if (FAILED(D3D11CreateDevice(adapter.Get(), D3D_DRIVER_TYPE_UNKNOWN, nullptr, flags, fls, ARRAYSIZE(fls),
                               D3D11_SDK_VERSION, &enc.device, &flOut, &enc.ctx))) {
    return false;
  }
  return SUCCEEDED(enc.device.As(&enc.device1));
}

static bool D3dProbeOk() {
  EncoderState probe;
  return EnsureD3D(probe);
}

static std::string NvErr(NVENCSTATUS st) {
  return "NVENC status " + std::to_string(static_cast<int>(st));
}

static void DestroyNvSession(EncoderState& enc) {
  auto& api = Api();
  if (!api.ok || !enc.nv) {
    enc.nv = nullptr;
    enc.registeredResource = nullptr;
    enc.inputBuffer = nullptr;
    enc.bitstream = nullptr;
    enc.inputTex.Reset();
    return;
  }
  if (enc.registeredResource) {
    api.fn.nvEncUnregisterResource(enc.nv, enc.registeredResource);
    enc.registeredResource = nullptr;
  }
  enc.inputTex.Reset();
  if (enc.inputBuffer) {
    api.fn.nvEncDestroyInputBuffer(enc.nv, enc.inputBuffer);
    enc.inputBuffer = nullptr;
  }
  if (enc.bitstream) {
    api.fn.nvEncDestroyBitstreamBuffer(enc.nv, enc.bitstream);
    enc.bitstream = nullptr;
  }
  api.fn.nvEncDestroyEncoder(enc.nv);
  enc.nv = nullptr;
  enc.frameIndex = 0;
}

static bool CreateInputTexture(EncoderState& enc, int width, int height) {
  if (!enc.device) return false;
  D3D11_TEXTURE2D_DESC desc{};
  desc.Width = static_cast<UINT>(width);
  desc.Height = static_cast<UINT>(height);
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  desc.SampleDesc.Count = 1;
  desc.Usage = D3D11_USAGE_DEFAULT;
  desc.BindFlags = D3D11_BIND_RENDER_TARGET;
  ComPtr<ID3D11Texture2D> tex;
  if (FAILED(enc.device->CreateTexture2D(&desc, nullptr, &tex))) return false;
  enc.inputTex = tex;
  return true;
}

// Last EnsureSession failure site (for JS error strings).
thread_local const char* g_nvStep = "";

static NVENCSTATUS EnsureSession(EncoderState& enc, int width, int height, int fps) {
  if (enc.nv && enc.width == width && enc.height == height && enc.fps == fps) {
    return NV_ENC_SUCCESS;
  }
  DestroyNvSession(enc);
  enc.width = width;
  enc.height = height;
  enc.fps = fps > 0 ? fps : 30;

  auto& api = Api();
  if (!api.ok) {
    g_nvStep = "api";
    return NV_ENC_ERR_NO_ENCODE_DEVICE;
  }
  if (!EnsureD3D(enc)) {
    g_nvStep = "d3d";
    return NV_ENC_ERR_NO_ENCODE_DEVICE;
  }

  // Align to NVENC macroblock requirements.
  width = (width + 1) & ~1;
  height = (height + 1) & ~1;
  enc.width = width;
  enc.height = height;

  NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS open{};
  open.version = NV_ENC_OPEN_ENCODE_SESSION_EX_PARAMS_VER;
  open.device = enc.device.Get();
  open.deviceType = NV_ENC_DEVICE_TYPE_DIRECTX;
  open.apiVersion = NVENCAPI_VERSION;
  g_nvStep = "open";
  NVENCSTATUS st = api.fn.nvEncOpenEncodeSessionEx(&open, &enc.nv);
  if (st != NV_ENC_SUCCESS) return st;

  // P1–P7 presets require GetEncodePresetConfigEx + matching tuningInfo on init.
  GUID preset = NV_ENC_PRESET_P1_GUID;
  const NV_ENC_TUNING_INFO tuning = NV_ENC_TUNING_INFO_LOW_LATENCY;
  NV_ENC_PRESET_CONFIG presetCfg{};
  presetCfg.version = NV_ENC_PRESET_CONFIG_VER;
  presetCfg.presetCfg.version = NV_ENC_CONFIG_VER;
  g_nvStep = "preset";
  st = api.fn.nvEncGetEncodePresetConfigEx(enc.nv, NV_ENC_CODEC_H264_GUID, preset, tuning, &presetCfg);
  if (st != NV_ENC_SUCCESS) {
    preset = NV_ENC_PRESET_P4_GUID;
    st = api.fn.nvEncGetEncodePresetConfigEx(enc.nv, NV_ENC_CODEC_H264_GUID, preset, tuning, &presetCfg);
    if (st != NV_ENC_SUCCESS) return st;
  }

  NV_ENC_CONFIG cfg{};
  std::memcpy(&cfg, &presetCfg.presetCfg, sizeof(cfg));
  cfg.version = NV_ENC_CONFIG_VER;
  // Prefer all-intra annex-B for ffmpeg -c:v copy; fall back to preset GOP if rejected.
  cfg.gopLength = 1;
  cfg.frameIntervalP = 0;
  cfg.encodeCodecConfig.h264Config.idrPeriod = 1;
  cfg.encodeCodecConfig.h264Config.repeatSPSPPS = 1;

  auto tryInit = [&](NV_ENC_CONFIG& c, int enablePtd) -> NVENCSTATUS {
    NV_ENC_INITIALIZE_PARAMS init{};
    init.version = NV_ENC_INITIALIZE_PARAMS_VER;
    init.encodeConfig = &c;
    init.encodeGUID = NV_ENC_CODEC_H264_GUID;
    init.presetGUID = preset;
    init.tuningInfo = tuning;
    init.encodeWidth = static_cast<uint32_t>(width);
    init.encodeHeight = static_cast<uint32_t>(height);
    init.darWidth = static_cast<uint32_t>(width);
    init.darHeight = static_cast<uint32_t>(height);
    init.frameRateNum = static_cast<uint32_t>(enc.fps);
    init.frameRateDen = 1;
    init.enablePTD = enablePtd;
    return api.fn.nvEncInitializeEncoder(enc.nv, &init);
  };

  // enablePTD=1: driver picks picture type; FORCEIDR on each frame for annex-B stills.
  g_nvStep = "init";
  enc.enablePtd = 1;
  st = tryInit(cfg, 1);
  if (st != NV_ENC_SUCCESS) return st;

  g_nvStep = "texture";
  if (!CreateInputTexture(enc, width, height)) return NV_ENC_ERR_OUT_OF_MEMORY;

  NV_ENC_REGISTER_RESOURCE reg{};
  reg.version = NV_ENC_REGISTER_RESOURCE_VER;
  reg.resourceType = NV_ENC_INPUT_RESOURCE_TYPE_DIRECTX;
  reg.resourceToRegister = enc.inputTex.Get();
  reg.width = width;
  reg.height = height;
  reg.pitch = 0;
  reg.bufferFormat = NV_ENC_BUFFER_FORMAT_ARGB;
  g_nvStep = "register";
  st = api.fn.nvEncRegisterResource(enc.nv, &reg);
  if (st != NV_ENC_SUCCESS) return st;
  enc.registeredResource = reg.registeredResource;

  NV_ENC_CREATE_INPUT_BUFFER ib{};
  ib.version = NV_ENC_CREATE_INPUT_BUFFER_VER;
  ib.width = width;
  ib.height = height;
  ib.bufferFmt = NV_ENC_BUFFER_FORMAT_NV12;
  g_nvStep = "inputbuf";
  st = api.fn.nvEncCreateInputBuffer(enc.nv, &ib);
  if (st != NV_ENC_SUCCESS) return st;
  enc.inputBuffer = ib.inputBuffer;

  NV_ENC_CREATE_BITSTREAM_BUFFER bb{};
  bb.version = NV_ENC_CREATE_BITSTREAM_BUFFER_VER;
  g_nvStep = "bitstream";
  st = api.fn.nvEncCreateBitstreamBuffer(enc.nv, &bb);
  if (st != NV_ENC_SUCCESS) return st;
  enc.bitstream = bb.bitstreamBuffer;
  g_nvStep = "ok";
  return NV_ENC_SUCCESS;
}

static HANDLE HandleFromBuffer(const uint8_t* data, size_t len) {
  if (len < sizeof(HANDLE)) return nullptr;
  return *reinterpret_cast<const HANDLE*>(data);
}

static void ParseEncodeSizeAt(const Napi::CallbackInfo& info, size_t owIdx, size_t ohIdx, int srcW, int srcH,
                              int& encW, int& encH) {
  encW = srcW;
  encH = srcH;
  if (info.Length() > ohIdx && info[owIdx].IsNumber() && info[ohIdx].IsNumber()) {
    const int ow = info[owIdx].As<Napi::Number>().Int32Value();
    const int oh = info[ohIdx].As<Napi::Number>().Int32Value();
    if (ow > 0 && oh > 0) {
      encW = ow;
      encH = oh;
    }
  }
}

thread_local uint32_t g_lastInputPitch = 0;

static void BgraPixelToYuv(uint8_t b, uint8_t g, uint8_t r, uint8_t& y, uint8_t& u, uint8_t& v) {
  // BT.601 full-range-ish (good enough for capture smoke).
  const int Y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
  const int U = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
  const int V = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
  y = static_cast<uint8_t>(Y < 0 ? 0 : (Y > 255 ? 255 : Y));
  u = static_cast<uint8_t>(U < 0 ? 0 : (U > 255 ? 255 : U));
  v = static_cast<uint8_t>(V < 0 ? 0 : (V > 255 ? 255 : V));
}

static bool UploadBgraToInputBuffer(EncoderState& enc, const uint8_t* bgra, int srcW, int srcH, int encW,
                                    int encH) {
  auto& api = Api();
  if (!enc.inputBuffer) return false;
  NV_ENC_LOCK_INPUT_BUFFER lock{};
  lock.version = NV_ENC_LOCK_INPUT_BUFFER_VER;
  lock.inputBuffer = enc.inputBuffer;
  if (api.fn.nvEncLockInputBuffer(enc.nv, &lock) != NV_ENC_SUCCESS) return false;
  auto* dst = static_cast<uint8_t*>(lock.bufferDataPtr);
  const uint32_t pitch = lock.pitch ? lock.pitch : static_cast<uint32_t>(encW);
  g_lastInputPitch = pitch;
  uint8_t* yPlane = dst;
  uint8_t* uvPlane = dst + pitch * static_cast<size_t>(encH);
  for (int y = 0; y < encH; y++) {
    const int sy = (srcH == encH) ? y : (y * srcH / encH);
    const uint8_t* srcRow = bgra + static_cast<size_t>(sy) * static_cast<size_t>(srcW) * 4;
    uint8_t* yRow = yPlane + static_cast<size_t>(y) * pitch;
    for (int x = 0; x < encW; x++) {
      const int sx = (srcW == encW) ? x : (x * srcW / encW);
      const uint8_t* p = srcRow + sx * 4;
      uint8_t Y, U, V;
      BgraPixelToYuv(p[0], p[1], p[2], Y, U, V);
      yRow[x] = Y;
      if ((y % 2 == 0) && (x % 2 == 0)) {
        uint8_t* uv = uvPlane + static_cast<size_t>(y / 2) * pitch + static_cast<size_t>(x);
        uv[0] = U;
        uv[1] = V;
      }
    }
  }
  return api.fn.nvEncUnlockInputBuffer(enc.nv, enc.inputBuffer) == NV_ENC_SUCCESS;
}

// 1 = DX registered texture ready, 2 = sysmem input buffer ready, 0 = fail.
static int CopySharedToInput(EncoderState& enc, HANDLE ntHandle, int encW, int encH) {
  if (!enc.device1 || !enc.ctx) return 0;
  ComPtr<ID3D11Texture2D> shared;
  HRESULT hr = enc.device1->OpenSharedResource1(ntHandle, IID_PPV_ARGS(&shared));
  if (FAILED(hr)) {
    hr = enc.device->OpenSharedResource(ntHandle, IID_PPV_ARGS(&shared));
    if (FAILED(hr)) return 0;
  }
  D3D11_TEXTURE2D_DESC desc{};
  shared->GetDesc(&desc);
  const int srcW = static_cast<int>(desc.Width);
  const int srcH = static_cast<int>(desc.Height);

  if (srcW == encW && srcH == encH && desc.Format == DXGI_FORMAT_B8G8R8A8_UNORM) {
    enc.ctx->CopyResource(enc.inputTex.Get(), shared.Get());
    return 1;
  }

  // Size/format mismatch: staging → NV12 sysmem.
  D3D11_TEXTURE2D_DESC stagingDesc = desc;
  stagingDesc.MipLevels = 1;
  stagingDesc.ArraySize = 1;
  stagingDesc.SampleDesc.Count = 1;
  stagingDesc.Usage = D3D11_USAGE_STAGING;
  stagingDesc.BindFlags = 0;
  stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  stagingDesc.MiscFlags = 0;
  ComPtr<ID3D11Texture2D> staging;
  if (FAILED(enc.device->CreateTexture2D(&stagingDesc, nullptr, &staging))) return 0;
  enc.ctx->CopyResource(staging.Get(), shared.Get());
  D3D11_MAPPED_SUBRESOURCE mapped{};
  if (FAILED(enc.ctx->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return 0;

  std::vector<uint8_t> bgra(static_cast<size_t>(srcW) * static_cast<size_t>(srcH) * 4);
  for (int y = 0; y < srcH; y++) {
    std::memcpy(bgra.data() + static_cast<size_t>(y) * srcW * 4,
                static_cast<uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch,
                static_cast<size_t>(srcW) * 4);
  }
  enc.ctx->Unmap(staging.Get(), 0);
  return UploadBgraToInputBuffer(enc, bgra.data(), srcW, srcH, encW, encH) ? 2 : 0;
}

thread_local const char* g_encStep = "";
thread_local NVENCSTATUS g_encStatus = NV_ENC_SUCCESS;

static std::vector<uint8_t> EncodeMapped(EncoderState& enc, void* inputBuffer, uint32_t pitch,
                                         NV_ENC_BUFFER_FORMAT fmt, bool unmapDx) {
  auto& api = Api();
  g_encStep = "encode";
  NV_ENC_PIC_PARAMS pic{};
  pic.version = NV_ENC_PIC_PARAMS_VER;
  pic.inputBuffer = inputBuffer;
  pic.bufferFmt = fmt;
  pic.inputWidth = static_cast<uint32_t>(enc.width);
  pic.inputHeight = static_cast<uint32_t>(enc.height);
  pic.inputPitch = pitch;
  pic.outputBitstream = enc.bitstream;
  pic.pictureStruct = NV_ENC_PIC_STRUCT_FRAME;
  pic.frameIdx = static_cast<uint32_t>(enc.frameIndex);
  pic.inputTimeStamp = static_cast<uint64_t>(enc.frameIndex);
  pic.encodePicFlags = NV_ENC_PIC_FLAG_FORCEIDR;
  enc.frameIndex++;

  NVENCSTATUS st = api.fn.nvEncEncodePicture(enc.nv, &pic);
  g_encStatus = st;
  auto cleanupDx = [&] {
    if (unmapDx) api.fn.nvEncUnmapInputResource(enc.nv, inputBuffer);
  };
  if (st != NV_ENC_SUCCESS && st != NV_ENC_ERR_NEED_MORE_INPUT) {
    cleanupDx();
    return {};
  }

  if (st == NV_ENC_ERR_NEED_MORE_INPUT) {
    g_encStep = "eos";
    NV_ENC_PIC_PARAMS eos{};
    eos.version = NV_ENC_PIC_PARAMS_VER;
    eos.encodePicFlags = NV_ENC_PIC_FLAG_EOS;
    st = api.fn.nvEncEncodePicture(enc.nv, &eos);
    g_encStatus = st;
    if (st != NV_ENC_SUCCESS) {
      cleanupDx();
      return {};
    }
  }

  g_encStep = "lock";
  NV_ENC_LOCK_BITSTREAM lock{};
  lock.version = NV_ENC_LOCK_BITSTREAM_VER;
  lock.outputBitstream = enc.bitstream;
  lock.doNotWait = 0;
  st = api.fn.nvEncLockBitstream(enc.nv, &lock);
  g_encStatus = st;
  if (st != NV_ENC_SUCCESS || !lock.bitstreamBufferPtr || lock.bitstreamSizeInBytes == 0) {
    cleanupDx();
    return {};
  }

  std::vector<uint8_t> out(static_cast<const uint8_t*>(lock.bitstreamBufferPtr),
                           static_cast<const uint8_t*>(lock.bitstreamBufferPtr) + lock.bitstreamSizeInBytes);
  api.fn.nvEncUnlockBitstream(enc.nv, enc.bitstream);
  cleanupDx();
  g_encStep = "ok";
  return out;
}

static std::vector<uint8_t> EncodeInputTexture(EncoderState& enc) {
  auto& api = Api();
  if (enc.ctx) enc.ctx->Flush();

  g_encStep = "map";
  NV_ENC_MAP_INPUT_RESOURCE map{};
  map.version = NV_ENC_MAP_INPUT_RESOURCE_VER;
  map.registeredResource = enc.registeredResource;
  NVENCSTATUS st = api.fn.nvEncMapInputResource(enc.nv, &map);
  if (st != NV_ENC_SUCCESS) {
    g_encStatus = st;
    return {};
  }
  return EncodeMapped(enc, map.mappedResource, 0, NV_ENC_BUFFER_FORMAT_ARGB, true);
}

static std::vector<uint8_t> EncodeInputBuffer(EncoderState& enc) {
  const uint32_t pitch = g_lastInputPitch ? g_lastInputPitch : static_cast<uint32_t>(enc.width);
  return EncodeMapped(enc, enc.inputBuffer, pitch, NV_ENC_BUFFER_FORMAT_NV12, false);
}

static std::vector<uint8_t> EncodeSharedHandle(EncoderState& enc, HANDLE ntHandle, int /*srcW*/, int /*srcH*/,
                                               int encW, int encH) {
  std::lock_guard<std::mutex> exclusive(enc.encodeExclusive);
  if (EnsureSession(enc, encW, encH, enc.fps) != NV_ENC_SUCCESS) {
    g_encStep = g_nvStep;
    return {};
  }
  const int path = CopySharedToInput(enc, ntHandle, encW, encH);
  if (path == 0) {
    g_encStep = "open-shared";
    return {};
  }
  if (path == 1) {
    auto out = EncodeInputTexture(enc);
    // DX ARGB register can fail EncodePicture on some drivers — fall back to staging→NV12.
    if (!out.empty()) return out;
    if (!enc.device1 || !enc.ctx) return {};
    ComPtr<ID3D11Texture2D> shared;
    if (FAILED(enc.device1->OpenSharedResource1(ntHandle, IID_PPV_ARGS(&shared))) &&
        FAILED(enc.device->OpenSharedResource(ntHandle, IID_PPV_ARGS(&shared)))) {
      return {};
    }
    D3D11_TEXTURE2D_DESC desc{};
    shared->GetDesc(&desc);
    D3D11_TEXTURE2D_DESC stagingDesc = desc;
    stagingDesc.MipLevels = 1;
    stagingDesc.ArraySize = 1;
    stagingDesc.SampleDesc.Count = 1;
    stagingDesc.Usage = D3D11_USAGE_STAGING;
    stagingDesc.BindFlags = 0;
    stagingDesc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    stagingDesc.MiscFlags = 0;
    ComPtr<ID3D11Texture2D> staging;
    if (FAILED(enc.device->CreateTexture2D(&stagingDesc, nullptr, &staging))) return {};
    enc.ctx->CopyResource(staging.Get(), shared.Get());
    D3D11_MAPPED_SUBRESOURCE mapped{};
    if (FAILED(enc.ctx->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped))) return {};
    const int srcW = static_cast<int>(desc.Width);
    const int srcH = static_cast<int>(desc.Height);
    std::vector<uint8_t> bgra(static_cast<size_t>(srcW) * static_cast<size_t>(srcH) * 4);
    for (int y = 0; y < srcH; y++) {
      std::memcpy(bgra.data() + static_cast<size_t>(y) * srcW * 4,
                  static_cast<uint8_t*>(mapped.pData) + static_cast<size_t>(y) * mapped.RowPitch,
                  static_cast<size_t>(srcW) * 4);
    }
    enc.ctx->Unmap(staging.Get(), 0);
    if (!UploadBgraToInputBuffer(enc, bgra.data(), srcW, srcH, encW, encH)) return {};
    return EncodeInputBuffer(enc);
  }
  return EncodeInputBuffer(enc);
}

static std::vector<uint8_t> EncodeBGRA(EncoderState& enc, const uint8_t* bgra, int width, int height, int encW,
                                       int encH) {
  std::lock_guard<std::mutex> exclusive(enc.encodeExclusive);
  if (EnsureSession(enc, encW, encH, enc.fps) != NV_ENC_SUCCESS) return {};
  if (!UploadBgraToInputBuffer(enc, bgra, width, height, encW, encH)) {
    g_encStep = "upload";
    return {};
  }
  return EncodeInputBuffer(enc);
}

static void RgbaToBgra(const uint8_t* rgba, int width, int height, bool flipY, std::vector<uint8_t>& bgra) {
  bgra.resize(static_cast<size_t>(width) * static_cast<size_t>(height) * 4);
  for (int y = 0; y < height; y++) {
    const int srcY = flipY ? (height - 1 - y) : y;
    const uint8_t* src = rgba + static_cast<size_t>(srcY) * static_cast<size_t>(width) * 4;
    uint8_t* dst = bgra.data() + static_cast<size_t>(y) * static_cast<size_t>(width) * 4;
    for (int x = 0; x < width; x++) {
      dst[x * 4 + 0] = src[x * 4 + 2];
      dst[x * 4 + 1] = src[x * 4 + 1];
      dst[x * 4 + 2] = src[x * 4 + 0];
      dst[x * 4 + 3] = src[x * 4 + 3];
    }
  }
}

static std::shared_ptr<EncoderState> LookupSession(int id) {
  std::lock_guard<std::mutex> lock(g_poolMu);
  auto it = g_pool.find(id);
  return it == g_pool.end() ? nullptr : it->second;
}

static std::shared_ptr<EncoderState> RequireSession(Napi::Env env, const Napi::CallbackInfo& info,
                                                    const char* label) {
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, std::string(label) + ": missing sessionId").ThrowAsJavaScriptException();
    return nullptr;
  }
  auto enc = LookupSession(info[0].As<Napi::Number>().Int32Value());
  if (!enc) {
    Napi::Error::New(env, std::string(label) + ": invalid or shut-down sessionId").ThrowAsJavaScriptException();
    return nullptr;
  }
  return enc;
}

static Napi::Buffer<uint8_t> OutOrThrow(Napi::Env env, const std::vector<uint8_t>& out, const char* label) {
  if (out.empty()) {
    Napi::Error::New(env, label).ThrowAsJavaScriptException();
    return Napi::Buffer<uint8_t>::New(env, 0);
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

}  // namespace

static Napi::Value Available(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), Api().ok && D3dProbeOk());
}

static Napi::Value InitEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) {
    Napi::TypeError::New(env, "initEncoder(width, height, fps) → sessionId").ThrowAsJavaScriptException();
    return env.Null();
  }
  int width = info[0].As<Napi::Number>().Int32Value();
  int height = info[1].As<Napi::Number>().Int32Value();
  int fps = info[2].As<Napi::Number>().Int32Value();

  if (!Api().ok) {
    Napi::Error::New(env, "nvEncodeAPI64.dll unavailable").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto enc = std::make_shared<EncoderState>();
  NVENCSTATUS st = EnsureSession(*enc, width, height, fps);
  if (st != NV_ENC_SUCCESS) {
    DestroyNvSession(*enc);
    Napi::Error::New(env, std::string("NVENC init failed at ") + g_nvStep + ": " + NvErr(st))
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  int id;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    id = g_nextSessionId++;
    g_pool.emplace(id, enc);
  }
  return Napi::Number::New(env, id);
}

static Napi::Value EncodeSharedTexture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "encodeSharedTexture(sessionId, handle, width, height, pixelFormat[, outW, outH])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto enc = RequireSession(env, info, "encodeSharedTexture");
  if (!enc) return env.Null();

  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  const int width = info[2].As<Napi::Number>().Int32Value();
  const int height = info[3].As<Napi::Number>().Int32Value();
  (void)info[4];
  int encW = width;
  int encH = height;
  ParseEncodeSizeAt(info, 5, 6, width, height, encW, encH);

  HANDLE handle = HandleFromBuffer(buf.Data(), buf.Length());
  if (!handle) {
    Napi::Error::New(env, "invalid DXGI ntHandle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::vector<uint8_t> out = EncodeSharedHandle(*enc, handle, width, height, encW, encH);
  if (out.empty()) {
    Napi::Error::New(env, std::string("NVENC shared-texture encode failed at ") + g_encStep + ": " +
                              NvErr(g_encStatus))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

class EncodeSharedWorker : public Napi::AsyncWorker {
 public:
  EncodeSharedWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::shared_ptr<EncoderState> enc,
                     HANDLE handle, int width, int height, int encW, int encH)
      : Napi::AsyncWorker(env),
        deferred_(deferred),
        enc_(std::move(enc)),
        width_(width),
        height_(height),
        encW_(encW),
        encH_(encH) {
    // Electron may release the OSR texture as soon as this call returns. Duplicate so the
    // worker can OpenSharedResource after tex.release() (mac path CFRetain's the IOSurface).
    if (handle &&
        !DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), &handle_, 0, FALSE,
                         DUPLICATE_SAME_ACCESS)) {
      handle_ = nullptr;
    }
  }

  ~EncodeSharedWorker() override {
    if (handle_) CloseHandle(handle_);
  }

  void Execute() override {
    if (!handle_) {
      SetError("DuplicateHandle failed for DXGI ntHandle");
      return;
    }
    out_ = EncodeSharedHandle(*enc_, handle_, width_, height_, encW_, encH_);
    if (out_.empty()) {
      SetError(std::string("NVENC shared-texture encode failed at ") + g_encStep + ": " + NvErr(g_encStatus));
    }
  }

  void OnOK() override {
    deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(Env(), out_.data(), out_.size()));
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<EncoderState> enc_;
  HANDLE handle_ = nullptr;
  int width_ = 0;
  int height_ = 0;
  int encW_ = 0;
  int encH_ = 0;
  std::vector<uint8_t> out_;
};

static Napi::Value EncodeSharedTextureAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "encodeSharedTextureAsync(sessionId, handle, width, height, pixelFormat[, outW, outH])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto enc = RequireSession(env, info, "encodeSharedTextureAsync");
  if (!enc) return env.Null();

  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  const int width = info[2].As<Napi::Number>().Int32Value();
  const int height = info[3].As<Napi::Number>().Int32Value();
  (void)info[4];
  int encW = width;
  int encH = height;
  ParseEncodeSizeAt(info, 5, 6, width, height, encW, encH);

  HANDLE handle = HandleFromBuffer(buf.Data(), buf.Length());
  if (!handle) {
    Napi::Error::New(env, "invalid DXGI ntHandle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new EncodeSharedWorker(env, deferred, std::move(enc), handle, width, height, encW, encH);
  worker->Queue();
  return deferred.Promise();
}

class EncodeRGBAWorker : public Napi::AsyncWorker {
 public:
  EncodeRGBAWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::shared_ptr<EncoderState> enc,
                   std::vector<uint8_t> rgba, int width, int height, bool flipY, int encW, int encH)
      : Napi::AsyncWorker(env),
        deferred_(deferred),
        enc_(std::move(enc)),
        rgba_(std::move(rgba)),
        width_(width),
        height_(height),
        flipY_(flipY),
        encW_(encW),
        encH_(encH) {}

  void Execute() override {
    std::vector<uint8_t> bgra;
    RgbaToBgra(rgba_.data(), width_, height_, flipY_, bgra);
    out_ = EncodeBGRA(*enc_, bgra.data(), width_, height_, encW_, encH_);
    if (out_.empty()) SetError("NVENC RGBA encode produced no H.264 output");
  }

  void OnOK() override {
    deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(Env(), out_.data(), out_.size()));
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<EncoderState> enc_;
  std::vector<uint8_t> rgba_;
  int width_ = 0;
  int height_ = 0;
  bool flipY_ = true;
  int encW_ = 0;
  int encH_ = 0;
  std::vector<uint8_t> out_;
};

static Napi::Value EncodeRgbaAsync(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "encodeRgbaAsync(sessionId, rgba, width, height[, flipY[, outW, outH]])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  auto enc = RequireSession(env, info, "encodeRgbaAsync");
  if (!enc) return env.Null();

  auto buf = info[1].As<Napi::Buffer<uint8_t>>();
  const int width = info[2].As<Napi::Number>().Int32Value();
  const int height = info[3].As<Napi::Number>().Int32Value();
  const bool flipY = info.Length() < 5 || !info[4].IsBoolean() || info[4].As<Napi::Boolean>().Value();
  int encW = width;
  int encH = height;
  if (info.Length() >= 7 && info[5].IsNumber() && info[6].IsNumber()) {
    ParseEncodeSizeAt(info, 5, 6, width, height, encW, encH);
  }
  const size_t need = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  if (buf.Length() < need) {
    Napi::Error::New(env, "encodeRgbaAsync: buffer too small for RGBA frame").ThrowAsJavaScriptException();
    return env.Null();
  }
  std::vector<uint8_t> rgba(buf.Data(), buf.Data() + need);
  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker =
      new EncodeRGBAWorker(env, deferred, std::move(enc), std::move(rgba), width, height, flipY, encW, encH);
  worker->Queue();
  return deferred.Promise();
}

static Napi::Value EncodeBitmap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4 || !info[1].IsBuffer()) {
    Napi::TypeError::New(env, "encodeBitmap(sessionId, bgra, width, height[, outW, outH])").ThrowAsJavaScriptException();
    return env.Null();
  }
  auto enc = RequireSession(env, info, "encodeBitmap");
  if (!enc) return env.Null();

  auto bmp = info[1].As<Napi::Buffer<uint8_t>>();
  const int width = info[2].As<Napi::Number>().Int32Value();
  const int height = info[3].As<Napi::Number>().Int32Value();
  int encW = width;
  int encH = height;
  ParseEncodeSizeAt(info, 4, 5, width, height, encW, encH);
  const size_t need = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  if (bmp.Length() < need) {
    Napi::Error::New(env, "encodeBitmap: buffer too small for BGRA frame").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::vector<uint8_t> out = EncodeBGRA(*enc, bmp.Data(), width, height, encW, encH);
  if (out.empty()) {
    Napi::Error::New(env, std::string("NVENC bitmap encode failed at ") + g_encStep + ": " + NvErr(g_encStatus))
        .ThrowAsJavaScriptException();
    return env.Null();
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

static Napi::Value ShutdownEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsNumber()) {
    Napi::TypeError::New(env, "shutdownEncoder(sessionId)").ThrowAsJavaScriptException();
    return env.Null();
  }
  const int id = info[0].As<Napi::Number>().Int32Value();
  std::shared_ptr<EncoderState> owned;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    auto it = g_pool.find(id);
    if (it == g_pool.end()) return env.Undefined();
    owned = std::move(it->second);
    g_pool.erase(it);
  }
  std::lock_guard<std::mutex> exclusive(owned->encodeExclusive);
  DestroyNvSession(*owned);
  owned->device1.Reset();
  owned->ctx.Reset();
  owned->device.Reset();
  return env.Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("initEncoder", Napi::Function::New(env, InitEncoder));
  exports.Set("encodeSharedTexture", Napi::Function::New(env, EncodeSharedTexture));
  exports.Set("encodeSharedTextureAsync", Napi::Function::New(env, EncodeSharedTextureAsync));
  exports.Set("encodeRgbaAsync", Napi::Function::New(env, EncodeRgbaAsync));
  exports.Set("encodeBitmap", Napi::Function::New(env, EncodeBitmap));
  exports.Set("shutdownEncoder", Napi::Function::New(env, ShutdownEncoder));
  return exports;
}

NODE_API_MODULE(gpu_capture, Init)
