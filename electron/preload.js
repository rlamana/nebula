const { contextBridge, ipcRenderer } = require('electron')

console.log('Preload script starting...')

const electronAPI = {
  parsePSD: (filePath) => ipcRenderer.invoke('parse-psd', filePath),
}

// Use contextBridge if available, otherwise fall back to window
if (typeof contextBridge !== 'undefined') {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI)
    console.log('electronAPI exposed via contextBridge')
  } catch (error) {
    console.error('Failed to expose electronAPI via contextBridge:', error)
    // Fallback to window
    window.electronAPI = electronAPI
    console.log('electronAPI set on window as fallback')
  }
} else {
  // Direct window assignment
  window.electronAPI = electronAPI
  console.log('electronAPI set directly on window')
}