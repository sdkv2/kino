// macOS: IOSurface (zero-copy when Electron provides it) or BGRA bitmap → VideoToolbox H.264 annex-B.
// Windows DXGI path not implemented — use KINO_ELECTRON_CAPTURE=page fallback.
#include <napi.h>

#ifdef __APPLE__

#import <CoreFoundation/CoreFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#import <IOSurface/IOSurface.h>
#import <VideoToolbox/VideoToolbox.h>
#import <Accelerate/Accelerate.h>

#include <cstring>
#include <mutex>
#include <vector>

namespace {

struct EncoderState {
  VTCompressionSessionRef session = nullptr;
  int width = 0;
  int height = 0;
  int fps = 30;
  int64_t frameIndex = 0;
  std::mutex mu;
  std::vector<uint8_t> out;
  bool gotFrame = false;
  OSStatus lastStatus = noErr;
};

EncoderState g_enc;

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
  (void)refCon;
  (void)sourceFrameRefCon;
  (void)infoFlags;
  std::lock_guard<std::mutex> lock(g_enc.mu);
  g_enc.lastStatus = status;
  g_enc.out.clear();
  if (status != noErr || !sampleBuffer) {
    g_enc.gotFrame = true;
    return;
  }
  g_enc.out = SampleBufferToAnnexB(sampleBuffer);
  g_enc.gotFrame = true;
}

static void ShutdownSessionLocked() {
  if (g_enc.session) {
    VTCompressionSessionCompleteFrames(g_enc.session, kCMTimeInvalid);
    VTCompressionSessionInvalidate(g_enc.session);
    CFRelease(g_enc.session);
    g_enc.session = nullptr;
  }
  g_enc.frameIndex = 0;
}

static OSStatus EnsureSession(int width, int height, int fps) {
  if (g_enc.session && g_enc.width == width && g_enc.height == height && g_enc.fps == fps) {
    return noErr;
  }
  ShutdownSessionLocked();
  g_enc.width = width;
  g_enc.height = height;
  g_enc.fps = fps > 0 ? fps : 30;

  OSStatus st = VTCompressionSessionCreate(
      nullptr, width, height, kCMVideoCodecType_H264, nullptr, nullptr, nullptr,
      CompressionCallback, nullptr, &g_enc.session);
  if (st != noErr) return st;

  int32_t one = 1;
  CFNumberRef n1 = CFNumberCreate(nullptr, kCFNumberSInt32Type, &one);
  int32_t bitrate = 50'000'000;
  CFNumberRef br = CFNumberCreate(nullptr, kCFNumberSInt32Type, &bitrate);

  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_RealTime, kCFBooleanTrue);
  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel);
  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_MaxKeyFrameInterval, n1);
  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse);
  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_AverageBitRate, br);
  VTSessionSetProperty(g_enc.session, kVTCompressionPropertyKey_ExpectedFrameRate, n1);

  if (n1) CFRelease(n1);
  if (br) CFRelease(br);

  return VTCompressionSessionPrepareToEncodeFrames(g_enc.session);
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
  const vImage_Error err = vImageScale_ARGB8888(&vSrc, &vDst, nullptr, kvImageHighQualityResampling);
  CVPixelBufferUnlockBaseAddress(dst, 0);
  CVPixelBufferUnlockBaseAddress(src, kCVPixelBufferLock_ReadOnly);
  if (err != kvImageNoError) {
    CVPixelBufferRelease(dst);
    return nullptr;
  }
  return dst;
}

static void ParseEncodeSize(const Napi::CallbackInfo& info, int srcW, int srcH, int& encW, int& encH) {
  encW = srcW;
  encH = srcH;
  if (info.Length() >= 6 && info[4].IsNumber() && info[5].IsNumber()) {
    const int ow = info[4].As<Napi::Number>().Int32Value();
    const int oh = info[5].As<Napi::Number>().Int32Value();
    if (ow > 0 && oh > 0) {
      encW = ow;
      encH = oh;
    }
  }
}

static std::vector<uint8_t> EncodePixelBuffer(CVPixelBufferRef pixelBuffer) {
  CMTime pts;
  VTCompressionSessionRef session;
  {
    std::lock_guard<std::mutex> lock(g_enc.mu);
    g_enc.gotFrame = false;
    g_enc.out.clear();
    g_enc.lastStatus = noErr;
    pts = CMTimeMake(g_enc.frameIndex++, g_enc.fps);
    session = g_enc.session;
  }

  CFDictionaryRef frameProps = nullptr;
  CFTypeRef keys[] = {kVTEncodeFrameOptionKey_ForceKeyFrame};
  CFTypeRef vals[] = {kCFBooleanTrue};
  frameProps = CFDictionaryCreate(nullptr, (const void**)keys, (const void**)vals, 1,
                                  &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);

  OSStatus st = VTCompressionSessionEncodeFrame(session, pixelBuffer, pts, kCMTimeInvalid, frameProps, nullptr, nullptr);
  if (frameProps) CFRelease(frameProps);
  if (st != noErr) return {};

  st = VTCompressionSessionCompleteFrames(session, pts);
  if (st != noErr) return {};

  std::lock_guard<std::mutex> lock(g_enc.mu);
  if (!g_enc.gotFrame || g_enc.lastStatus != noErr || g_enc.out.empty()) return {};
  return g_enc.out;
}

}  // namespace

static Napi::Value Available(const Napi::CallbackInfo& info) {
  (void)info;
  return Napi::Boolean::New(info.Env(), true);
}

static Napi::Value InitEncoder(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3) {
    Napi::TypeError::New(env, "initEncoder(width, height, fps)").ThrowAsJavaScriptException();
    return env.Null();
  }
  int width = info[0].As<Napi::Number>().Int32Value();
  int height = info[1].As<Napi::Number>().Int32Value();
  int fps = info[2].As<Napi::Number>().Int32Value();
  std::lock_guard<std::mutex> lock(g_enc.mu);
  OSStatus st = EnsureSession(width, height, fps);
  if (st != noErr) {
    Napi::Error::New(env, "VTCompressionSessionCreate failed: " + std::to_string(st)).ThrowAsJavaScriptException();
    return env.Null();
  }
  return env.Undefined();
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
  if (info.Length() < 4 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "encodeSharedTexture(handle, width, height, pixelFormat[, outW, outH])")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  const int width = info[1].As<Napi::Number>().Int32Value();
  const int height = info[2].As<Napi::Number>().Int32Value();
  (void)info[3];
  int encW = width;
  int encH = height;
  ParseEncodeSize(info, width, height, encW, encH);

  IOSurfaceRef surface = SurfaceFromHandle(buf.Data(), buf.Length());
  if (!surface) {
    Napi::Error::New(env, "invalid IOSurface handle buffer").ThrowAsJavaScriptException();
    return env.Null();
  }

  {
    std::lock_guard<std::mutex> lock(g_enc.mu);
    OSStatus st = EnsureSession(encW, encH, g_enc.fps);
    if (st != noErr) {
      Napi::Error::New(env, "encoder init failed: " + std::to_string(st)).ThrowAsJavaScriptException();
      return env.Null();
    }
  }

  CVPixelBufferRef pixelBuffer = nullptr;
  OSStatus st = CVPixelBufferCreateWithIOSurface(kCFAllocatorDefault, surface, nullptr, &pixelBuffer);
  if (st != noErr || !pixelBuffer) {
    Napi::Error::New(env, "CVPixelBufferCreateWithIOSurface failed: " + std::to_string(st)).ThrowAsJavaScriptException();
    return env.Null();
  }

  CVPixelBufferRef encodeBuf = ScalePixelBuffer(pixelBuffer, encW, encH);
  CVPixelBufferRelease(pixelBuffer);
  if (!encodeBuf) {
    Napi::Error::New(env, "IOSurface scale failed").ThrowAsJavaScriptException();
    return env.Null();
  }

  std::vector<uint8_t> out = EncodePixelBuffer(encodeBuf);
  CVPixelBufferRelease(encodeBuf);
  return OutOrThrow(env, out, "VideoToolbox IOSurface encode produced no H.264 output");
}

static Napi::Value EncodeBitmap(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 3 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "encodeBitmap(bgra, width, height[, outW, outH])").ThrowAsJavaScriptException();
    return env.Null();
  }

  auto bmp = info[0].As<Napi::Buffer<uint8_t>>();
  const int width = info[1].As<Napi::Number>().Int32Value();
  const int height = info[2].As<Napi::Number>().Int32Value();
  int encW = width;
  int encH = height;
  ParseEncodeSize(info, width, height, encW, encH);
  const size_t need = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  if (bmp.Length() < need) {
    Napi::Error::New(env, "encodeBitmap: buffer too small for BGRA frame").ThrowAsJavaScriptException();
    return env.Null();
  }

  {
    std::lock_guard<std::mutex> lock(g_enc.mu);
    OSStatus st = EnsureSession(encW, encH, g_enc.fps);
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

  std::vector<uint8_t> out = EncodePixelBuffer(encodeBuf);
  CVPixelBufferRelease(encodeBuf);
  return OutOrThrow(env, out, "VideoToolbox bitmap encode produced no H.264 output");
}

static Napi::Value ShutdownEncoder(const Napi::CallbackInfo& info) {
  (void)info;
  std::lock_guard<std::mutex> lock(g_enc.mu);
  ShutdownSessionLocked();
  return info.Env().Undefined();
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("available", Napi::Function::New(env, Available));
  exports.Set("initEncoder", Napi::Function::New(env, InitEncoder));
  exports.Set("encodeSharedTexture", Napi::Function::New(env, EncodeSharedTexture));
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
