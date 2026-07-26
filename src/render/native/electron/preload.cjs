// Electron preload — bridges WebGL readPixels bytes to the worker main process without
// going through OSR paint/IOSurface. contextIsolation stays on; only this API is exposed.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kinoElectron", {
  /** Push one RGBA frame (canvas readPixels) to the worker for VideoToolbox encode. */
  pushFrame: (rgba, width, height) => ipcRenderer.invoke("kino:push-frame", rgba, width, height),
  /** Push one annex-B AU (WebCodecs present-bypass) to the worker. */
  pushH264: (annexB) => ipcRenderer.invoke("kino:push-h264", annexB),
  /** Fire-and-forget: GL seek done — main can invalidate OSR before executeJavaScript returns. */
  frameReady: (frame) => ipcRenderer.send("kino:frame-ready", frame),
});
