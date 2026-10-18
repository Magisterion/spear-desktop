// Keep this sandbox preload self-contained: Electron only permits built-in modules.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('classic', {
  request: (action, value) =>
    ipcRenderer.invoke('classic:local', action, value),
});
