const { contextBridge, ipcRenderer } = require("electron");
console.log("Preload script starting...");
const electronAPI = {
  parsePSD: (filePath) => ipcRenderer.invoke("parse-psd", filePath),
  readDirectory: (dirPath) => ipcRenderer.invoke("read-directory", dirPath),
  getHomeDirectory: () => ipcRenderer.invoke("get-home-directory")
};
if (typeof contextBridge !== "undefined") {
  try {
    contextBridge.exposeInMainWorld("electronAPI", electronAPI);
    console.log("electronAPI exposed via contextBridge");
  } catch (error) {
    console.error("Failed to expose electronAPI via contextBridge:", error);
    window.electronAPI = electronAPI;
    console.log("electronAPI set on window as fallback");
  }
} else {
  window.electronAPI = electronAPI;
  console.log("electronAPI set directly on window");
}
