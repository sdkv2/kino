{
  "targets": [
    {
      "target_name": "gpu_capture",
      "sources": ["gpu_capture.mm"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
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
        }]
      ]
    }
  ]
}
