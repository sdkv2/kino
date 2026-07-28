{
  "targets": [
    {
      "target_name": "gpu_capture",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "."
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["gpu_capture.mm"],
          "libraries": [
            "-framework IOSurface",
            "-framework CoreVideo",
            "-framework VideoToolbox",
            "-framework CoreMedia",
            "-framework CoreFoundation"
          ],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "12.0"
          }
        }],
        ["OS=='win'", {
          "sources": ["gpu_capture_win.cc"],
          "libraries": [
            "d3d11.lib",
            "dxgi.lib"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }],
        ["OS=='linux'", {
          "sources": ["gpu_capture_linux.cc"],
          "libraries": ["-ldl"],
          "cflags_cc": ["-std=c++17", "-fexceptions"]
        }]
      ]
    }
  ]
}
