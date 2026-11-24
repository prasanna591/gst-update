const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gstApi", {
  desktopNotify: (title, body) => {
    ipcRenderer.send("desktop-notify", { title, body });
  },
});
