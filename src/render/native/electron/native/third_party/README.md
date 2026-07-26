# Vendored native headers

`ffnvcodec/nvEncodeAPI.h` — from [FFmpeg nv-codec-headers](https://github.com/FFmpeg/nv-codec-headers)
tag `n12.2.72.0` (NVENC API 12.2). Runtime loads `nvEncodeAPI64.dll` from the GPU driver.
Do not bump past what the installed driver advertises (`NvEncodeAPIGetMaxSupportedVersion`).
