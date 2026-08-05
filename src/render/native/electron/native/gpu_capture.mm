// macOS: IOSurface (zero-copy when Electron provides it) or BGRA bitmap → VideoToolbox H.264 annex-B.
// Multi-session: each initEncoder() returns a session id so concurrent offscreen windows encode in
// parallel (one VTCompressionSession each). Windows DXGI path not implemented — use page fallback.
#include <napi.h>

#ifdef __APPLE__

#import <CoreFoundation/CoreFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <VideoToolbox/VideoToolbox.h>
#import <Accelerate/Accelerate.h>

#include <cstdlib>
#include <cstring>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <vector>

namespace {

struct EncoderState {
  VTCompressionSessionRef session = nullptr;
  int width = 0;
  int height = 0;
  int fps = 30;
  int64_t frameIndex = 0;
  // Session + gotFrame/out. Must NOT be held across EncodeFrame — VT may invoke the callback on
  // another thread, which also takes mu (holding → deadlock).
  std::mutex mu;
  // One in-flight encode per session (gotFrame/out are not a queue).
  std::mutex encodeExclusive;
  std::vector<uint8_t> out;
  bool gotFrame = false;
  OSStatus lastStatus = noErr;
};

std::mutex g_poolMu;
std::unordered_map<int, std::shared_ptr<EncoderState>> g_pool;
int g_nextSessionId = 1;

static void AppendAnnexB(std::vector<uint8_t>& out, const uint8_t* nal, size_t len) {
  out.push_back(0);
  out.push_back(0);
  out.push_back(0);
  out.push_back(1);
  out.insert(out.end(), nal, nal + len);
}

static void AppendSpsPps(std::vector<uint8_t>& out, CMFormatDescriptionRef fmt) {
  size_t count = 0;
  CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, 0, nullptr, nullptr, &count, nullptr);
  for (size_t i = 0; i < count; i++) {
    const uint8_t* param = nullptr;
    size_t paramSize = 0;
    if (CMVideoFormatDescriptionGetH264ParameterSetAtIndex(fmt, i, &param, &paramSize, nullptr, nullptr) == noErr) {
      AppendAnnexB(out, param, paramSize);
    }
  }
}

static std::vector<uint8_t> SampleBufferToAnnexB(CMSampleBufferRef sample) {
  std::vector<uint8_t> out;
  CMFormatDescriptionRef fmt = CMSampleBufferGetFormatDescription(sample);
  if (!fmt) return out;

  bool isKeyframe = true;
  CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
  if (attachments && CFArrayGetCount(attachments) > 0) {
    CFDictionaryRef dict = (CFDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
    CFBooleanRef notSync = (CFBooleanRef)CFDictionaryGetValue(dict, kCMSampleAttachmentKey_NotSync);
    isKeyframe = !notSync || !CFBooleanGetValue(notSync);
  }

  if (isKeyframe) AppendSpsPps(out, fmt);

  CMBlockBufferRef block = CMSampleBufferGetDataBuffer(sample);
  if (!block) return out;

  size_t total = 0;
  char* data = nullptr;
  if (CMBlockBufferGetDataPointer(block, 0, nullptr, &total, &data) != kCMBlockBufferNoErr) return out;

  size_t offset = 0;
  while (offset + 4 <= total) {
    uint32_t nalLen = (uint8_t)data[offset] << 24 | (uint8_t)data[offset + 1] << 16 |
                      (uint8_t)data[offset + 2] << 8 | (uint8_t)data[offset + 3];
    offset += 4;
    if (nalLen == 0 || offset + nalLen > total) break;
    AppendAnnexB(out, reinterpret_cast<uint8_t*>(data) + offset, nalLen);
    offset += nalLen;
  }
  return out;
}

static void CompressionCallback(void* refCon,
                                void* sourceFrameRefCon,
                                OSStatus status,
                                VTEncodeInfoFlags infoFlags,
                                CMSampleBufferRef sampleBuffer) {
  (void)sourceFrameRefCon;
  (void)infoFlags;
  auto* enc = static_cast<EncoderState*>(refCon);
  if (!enc) return;
  std::lock_guard<std::mutex> lock(enc->mu);
  enc->lastStatus = status;
  enc->out.clear();
  if (status != noErr || !sampleBuffer) {
    enc->gotFrame = true;
    return;
  }
  enc->out = SampleBufferToAnnexB(sampleBuffer);
  enc->gotFrame = true;
}

static void ShutdownSessionLocked(EncoderState& enc) {
  if (enc.session) {
    VTCompressionSessionCompleteFrames(enc.session, kCMTimeInvalid);
    VTCompressionSessionInvalidate(enc.session);
    CFRelease(enc.session);
    enc.session = nullptr;
  }
  enc.frameIndex = 0;
}

static OSStatus EnsureSession(EncoderState& enc, int width, int height, int fps) {
  if (enc.session && enc.width == width && enc.height == height && enc.fps == fps) {
    return noErr;
  }
  ShutdownSessionLocked(enc);
  enc.width = width;
  enc.height = height;
  enc.fps = fps > 0 ? fps : 30;

  CFMutableDictionaryRef encSpec = CFDictionaryCreateMutable(
      nullptr, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(encSpec, kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder,
                       kCFBooleanTrue);

  OSStatus st = VTCompressionSessionCreate(
      nullptr, width, height, kCMVideoCodecType_H264, encSpec, nullptr, nullptr,
      CompressionCallback, &enc, &enc.session);
  if (encSpec) CFRelease(encSpec);
  if (st != noErr) return st;

  int32_t one = 1;
  CFNumberRef n1 = CFNumberCreate(nullptr, kCFNumberSInt32Type, &one);
  int32_t fpsVal = enc.fps;
  CFNumberRef fpsNum = CFNumberCreate(nullptr, kCFNumberSInt32Type, &fpsVal);
  // 50 Mbps is chosen for a 1080-class canvas; scale by pixel count so a *-4k session is not
  // encoded at a quarter of the per-pixel quality of its 1080 twin. Measured before this scaled:
  // 0.156 bits/px at 4K against 0.765 at 1080, with the 4K file SMALLER (45MB vs 55MB) despite
  // four times the pixels — the encoder was simply hitting the cap. Capture is all-intra and
  // ffmpeg remuxes with `-c:v copy`, so this bitstream is the deliverable and nothing recovers the
  // detail later. Mirrors h264Bitrate() in page/captureH264.ts.
  //
  // Scales UP only: every 1080-class format and every draft is at or below the base, so the clamp
  // leaves them at exactly 50 Mbps. 200 Mbps at 4K still fits comfortably in int32.
  const int64_t kBasePixels = 1920LL * 1080LL;
  const int64_t px = static_cast<int64_t>(width) * static_cast<int64_t>(height);
  int32_t bitrate = static_cast<int32_t>((50'000'000LL * (px > kBasePixels ? px : kBasePixels)) / kBasePixels);
  CFNumberRef br = CFNumberCreate(nullptr, kCFNumberSInt32Type, &bitrate);

  // Speed knobs default OFF: this all-intra bitstream is remuxed with `-c:v copy`, so it IS the
  // deliverable, and VT's fast RD path visibly flattens fine grain in dark gradients (banding on
  // near-black footage — found on the unveil trailer's fog beat) with no downstream recovery.
  // Mirrors the "quality" latencyMode decision documented in page/captureH264.ts. Set
  // KINO_CAPTURE_FAST=1 to restore realtime RC + speed-over-quality for throughput farms whose
  // output is re-encoded before anyone sees it.
  const char* fastEnv = std::getenv("KINO_CAPTURE_FAST");
  const bool fastMode = fastEnv && fastEnv[0] && std::strcmp(fastEnv, "0") != 0;
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_RealTime,
                       fastMode ? kCFBooleanTrue : kCFBooleanFalse);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_MaxKeyFrameInterval, n1);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_AverageBitRate, br);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_ExpectedFrameRate, fpsNum);
  if (fastMode) {
    VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_PrioritizeEncodingSpeedOverQuality, kCFBooleanTrue);
  }
  int32_t zero = 0;
  CFNumberRef n0 = CFNumberCreate(nullptr, kCFNumberSInt32Type, &zero);
  VTSessionSetProperty(enc.session, kVTCompressionPropertyKey_MaxFrameDelayCount, n0);

  if (n1) CFRelease(n1);
  if (n0) CFRelease(n0);
  if (fpsNum) CFRelease(fpsNum);
  if (br) CFRelease(br);

  return VTCompressionSessionPrepareToEncodeFrames(enc.session);
}

/** Shared ownership so AsyncWorkers survive shutdownEncoder racing the pool erase. */
static std::shared_ptr<EncoderState> LookupSession(int id) {
  std::lock_guard<std::mutex> lock(g_poolMu);
  auto it = g_pool.find(id);
  return it == g_pool.end() ? nullptr : it->second;
}

static IOSurfaceRef SurfaceFromHandle(const uint8_t* data, size_t len) {
  if (len < sizeof(void*)) return nullptr;
  return *reinterpret_cast<IOSurfaceRef*>(const_cast<uint8_t*>(data));
}

static CVPixelBufferRef MakeBGRAPixelBuffer(int width, int height) {
  CVPixelBufferRef pb = nullptr;
  CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, nullptr, &pb);
  return pb;
}

static CVPixelBufferRef ScalePixelBuffer(CVPixelBufferRef src, int outW, int outH) {
  if (!src) return nullptr;
  const int srcW = static_cast<int>(CVPixelBufferGetWidth(src));
  const int srcH = static_cast<int>(CVPixelBufferGetHeight(src));
  if (srcW == outW && srcH == outH) {
    CVPixelBufferRetain(src);
    return src;
  }
  CVPixelBufferRef dst = MakeBGRAPixelBuffer(outW, outH);
  if (!dst) return nullptr;

  CVPixelBufferLockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
  CVPixelBufferLockBaseAddress(dst, 0);
  vImage_Buffer vSrc = {
      .data = CVPixelBufferGetBaseAddress(src),
      .height = static_cast<vImagePixelCount>(srcH),
      .width = static_cast<vImagePixelCount>(srcW),
      .rowBytes = CVPixelBufferGetBytesPerRow(src),
  };
  vImage_Buffer vDst = {
      .data = CVPixelBufferGetBaseAddress(dst),
      .height = static_cast<vImagePixelCount>(outH),
      .width = static_cast<vImagePixelCount>(outW),
      .rowBytes = CVPixelBufferGetBytesPerRow(dst),
  };
  const vImage_Error err = vImageScale_ARGB8888(&vSrc, &vDst, nullptr, kvImageNoFlags);
  CVPixelBufferUnlockBaseAddress(dst, 0);
  CVPixelBufferUnlockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
  if (err != kvImageNoError) {
    CVPixelBufferRelease(dst);
    return nullptr;
  }
  return dst;
}

/** outW/outH at optional indices (defaults: 5,6 after sessionId + buffer + dims…). */
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

static std::vector<uint8_t> EncodePixelBuffer(EncoderState& enc, CVPixelBufferRef pixelBuffer) {
  CMTime pts;
  VTCompressionSessionRef session;
  {
    std::lock_guard<std::mutex> lock(enc.mu);
    enc.gotFrame = false;
    enc.out.clear();
    enc.lastStatus = noErr;
    pts = CMTimeMake(enc.frameIndex++, enc.fps);
    session = enc.session;
  }

  OSStatus st = VTCompressionSessionEncodeFrame(session, pixelBuffer, pts, kCMTimeInvalid, nullptr, nullptr, nullptr);
  if (st != noErr) return {};

  {
    std::lock_guard<std::mutex> lock(enc.mu);
    if (enc.gotFrame) {
      if (enc.lastStatus != noErr || enc.out.empty()) return {};
      return enc.out;
    }
  }

  st = VTCompressionSessionCompleteFrames(session, pts);
  if (st != noErr) return {};

  std::lock_guard<std::mutex> lock(enc.mu);
  if (!enc.gotFrame || enc.lastStatus != noErr || enc.out.empty()) return {};
  return enc.out;
}

static std::vector<uint8_t> EncodeIOSurface(EncoderState& enc, IOSurfaceRef surface, int width, int height,
                                            int encW, int encH) {
  (void)width;
  (void)height;
  std::lock_guard<std::mutex> exclusive(enc.encodeExclusive);
  {
    std::lock_guard<std::mutex> lock(enc.mu);
    OSStatus st = EnsureSession(enc, encW, encH, enc.fps);
    if (st != noErr) return {};
  }

  CVPixelBufferRef pixelBuffer = nullptr;
  OSStatus st = CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nullptr, &pixelBuffer);
  if (st != noErr || !pixelBuffer) return {};

  CVPixelBufferRef encodeBuf = ScalePixelBuffer(pixelBuffer, encW, encH);
  CVPixelBufferRelease(pixelBuffer);
  if (!encodeBuf) return {};

  std::vector<uint8_t> out = EncodePixelBuffer(enc, encodeBuf);
  CVPixelBufferRelease(encodeBuf);
  return out;
}

static CVPixelBufferRef PixelBufferFromRGBA(const uint8_t* rgba, int width, int height, bool flipY) {
  CVPixelBufferRef pb = MakeBGRAPixelBuffer(width, height);
  if (!pb) return nullptr;
  CVPixelBufferLockBaseAddress(pb, 0);
  uint8_t* dstBase = static_cast<uint8_t*>(CVPixelBufferGetBaseAddress(pb));
  const size_t dstStride = CVPixelBufferGetBytesPerRow(pb);
  for (int y = 0; y < height; y++) {
    const int srcY = flipY ? (height - 1 - y) : y;
    const uint8_t* src = rgba + static_cast<size_t>(srcY) * static_cast<size_t>(width) * 4;
    uint8_t* dst = dstBase + static_cast<size_t>(y) * dstStride;
    for (int x = 0; x < width; x++) {
      dst[x * 4 + 0] = src[x * 4 + 2];
      dst[x * 4 + 1] = src[x * 4 + 1];
      dst[x * 4 + 2] = src[x * 4 + 0];
      dst[x * 4 + 3] = src[x * 4 + 3];
    }
  }
  CVPixelBufferUnlockBaseAddress(pb, 0);
  return pb;
}

static std::vector<uint8_t> EncodeRGBA(EncoderState& enc, const uint8_t* rgba, int width, int height, bool flipY,
                                       int encW, int encH) {
  std::lock_guard<std::mutex> exclusive(enc.encodeExclusive);
  {
    std::lock_guard<std::mutex> lock(enc.mu);
    OSStatus st = EnsureSession(enc, encW, encH, enc.fps);
    if (st != noErr) return {};
  }
  CVPixelBufferRef pixelBuffer = PixelBufferFromRGBA(rgba, width, height, flipY);
  if (!pixelBuffer) return {};
  CVPixelBufferRef encodeBuf = ScalePixelBuffer(pixelBuffer, encW, encH);
  CVPixelBufferRelease(pixelBuffer);
  if (!encodeBuf) return {};
  std::vector<uint8_t> out = EncodePixelBuffer(enc, encodeBuf);
  CVPixelBufferRelease(encodeBuf);
  return out;
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

}  // namespace

static Napi::Value Available(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
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

  auto enc = std::make_shared<EncoderState>();
  {
    std::lock_guard<std::mutex> lock(enc->mu);
    OSStatus st = EnsureSession(*enc, width, height, fps);
    if (st != noErr) {
      Napi::Error::New(env, "VTCompressionSessionCreate failed: " + std::to_string(st)).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  int id;
  {
    std::lock_guard<std::mutex> lock(g_poolMu);
    id = g_nextSessionId++;
    g_pool.emplace(id, enc);
  }
  return Napi::Number::New(env, id);
}

static Napi::Buffer<uint8_t> OutOrThrow(Napi::Env env, const std::vector<uint8_t>& out, const char* label) {
  if (out.empty()) {
    Napi::Error::New(env, label).ThrowAsJavaScriptException();
    return Napi::Buffer<uint8_t>::New(env, 0);
  }
  return Napi::Buffer<uint8_t>::Copy(env, out.data(), out.size());
}

static Napi::Value EncodeSharedTexture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // encodeSharedTexture(sessionId, handle, width, height, pixelFormat[, outW, outH])
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

  IOSurfaceRef surface = SurfaceFromHandle(buf.Data(), buf.Length());
  if (!surface) {
    Napi::Error::New(env, "invalid IOSurface handle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::vector<uint8_t> out = EncodeIOSurface(*enc, surface, width, height, encW, encH);
  return OutOrThrow(env, out, "VideoToolbox IOSurface encode produced no H.264 output");
}

class EncodeIOSurfaceWorker : public Napi::AsyncWorker {
 public:
  EncodeIOSurfaceWorker(Napi::Env env,
                        Napi::Promise::Deferred deferred,
                        std::shared_ptr<EncoderState> enc,
                        IOSurfaceRef surface,
                        int width,
                        int height,
                        int encW,
                        int encH)
      : Napi::AsyncWorker(env),
        deferred_(deferred),
        enc_(std::move(enc)),
        surface_(surface),
        width_(width),
        height_(height),
        encW_(encW),
        encH_(encH) {
    if (surface_) CFRetain(surface_);
  }

  ~EncodeIOSurfaceWorker() override {
    if (surface_) CFRelease(surface_);
  }

  void Execute() override {
    out_ = EncodeIOSurface(*enc_, surface_, width_, height_, encW_, encH_);
    if (out_.empty()) SetError("VideoToolbox IOSurface encode produced no H.264 output");
  }

  void OnOK() override {
    deferred_.Resolve(Napi::Buffer<uint8_t>::Copy(Env(), out_.data(), out_.size()));
  }

  void OnError(const Napi::Error& e) override { deferred_.Reject(e.Value()); }

 private:
  Napi::Promise::Deferred deferred_;
  std::shared_ptr<EncoderState> enc_;
  IOSurfaceRef surface_ = nullptr;
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

  IOSurfaceRef surface = SurfaceFromHandle(buf.Data(), buf.Length());
  if (!surface) {
    Napi::Error::New(env, "invalid IOSurface handle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto deferred = Napi::Promise::Deferred::New(env);
  auto* worker = new EncodeIOSurfaceWorker(env, deferred, std::move(enc), surface, width, height, encW, encH);
  worker->Queue();
  return deferred.Promise();
}

class EncodeRGBAWorker : public Napi::AsyncWorker {
 public:
  EncodeRGBAWorker(Napi::Env env,
                   Napi::Promise::Deferred deferred,
                   std::shared_ptr<EncoderState> enc,
                   std::vector<uint8_t> rgba,
                   int width,
                   int height,
                   bool flipY,
                   int encW,
                   int encH)
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
    out_ = EncodeRGBA(*enc_, rgba_.data(), width_, height_, flipY_, encW_, encH_);
    if (out_.empty()) SetError("VideoToolbox RGBA encode produced no H.264 output");
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
  // encodeRgbaAsync(sessionId, rgba, width, height[, flipY[, outW, outH]])
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
  auto* worker = new EncodeRGBAWorker(env, deferred, std::move(enc), std::move(rgba), width, height, flipY, encW, encH);
  worker->Queue();
  return deferred.Promise();
}

static Napi::Value EncodeBitmap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // encodeBitmap(sessionId, bgra, width, height[, outW, outH])
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

  std::lock_guard<std::mutex> exclusive(enc->encodeExclusive);
  {
    std::lock_guard<std::mutex> lock(enc->mu);
    OSStatus st = EnsureSession(*enc, encW, encH, enc->fps);
    if (st != noErr) {
      Napi::Error::New(env, "encoder init failed: " + std::to_string(st)).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  CVPixelBufferRef pixelBuffer = MakeBGRAPixelBuffer(width, height);
  if (!pixelBuffer) {
    Napi::Error::New(env, "CVPixelBufferCreate failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  CVPixelBufferLockBaseAddress(pixelBuffer, 0);
  void* dst = CVPixelBufferGetBaseAddress(pixelBuffer);
  const size_t dstStride = CVPixelBufferGetBytesPerRow(pixelBuffer);
  const uint8_t* src = bmp.Data();
  for (int y = 0; y < height; y++) {
    std::memcpy(static_cast<uint8_t*>(dst) + y * dstStride, src + y * width * 4, width * 4);
  }
  CVPixelBufferUnlockBaseAddress(pixelBuffer, 0);

  CVPixelBufferRef encodeBuf = ScalePixelBuffer(pixelBuffer, encW, encH);
  CVPixelBufferRelease(pixelBuffer);
  if (!encodeBuf) {
    Napi::Error::New(env, "bitmap scale failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::vector<uint8_t> out = EncodePixelBuffer(*enc, encodeBuf);
  CVPixelBufferRelease(encodeBuf);
  return OutOrThrow(env, out, "VideoToolbox bitmap encode produced no H.264 output");
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
  // Wait for any in-flight encode on this session, then tear down VT.
  std::lock_guard<std::mutex> exclusive(owned->encodeExclusive);
  std::lock_guard<std::mutex> lock(owned->mu);
  ShutdownSessionLocked(*owned);
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

#else  // !__APPLE__

static Napi::Value Unavailable(const Napi::CallbackInfo& info) {
  Napi::Error::New(info.Env(), "gpu_capture: IOSurface/VideoToolbox only on macOS (DXGI not implemented)").ThrowAsJavaScriptException();
  return info.Env().Null();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, [](const Napi::CallbackInfo& i) {
    return Napi::Boolean::New(i.Env(), false);
  }));
  exports.Set("initEncoder", Napi::Function::New(env, Unavailable));
  exports.Set("encodeSharedTexture", Napi::Function::New(env, Unavailable));
  exports.Set("encodeBitmap", Napi::Function::New(env, Unavailable));
  exports.Set("shutdownEncoder", Napi::Function::New(env, Unavailable));
  return exports;
}

NODE_API_MODULE(gpu_capture, Init)

#endif
