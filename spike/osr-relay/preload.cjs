const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("spike", {
  onFrame: (cb) => {
    ipcRenderer.on("spike:frame", (_e, payload) => {
      cb(payload);
    });
  },
  uploadDone: (result) => ipcRenderer.send("spike:upload-done", result),
});
