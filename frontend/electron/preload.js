const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gstApi", {
  desktopNotify: (payloadOrTitle, body) => {
    const payload = payloadOrTitle && typeof payloadOrTitle === "object"
      ? payloadOrTitle
      : { title: payloadOrTitle, body };
    return ipcRenderer.invoke("desktop-notify", payload);
  },
  onNotificationClick: (callback) => {
    const listener = (_event, link) => callback(link);
    ipcRenderer.on("notification-click", listener);
    return () => ipcRenderer.removeListener("notification-click", listener);
  },
});
