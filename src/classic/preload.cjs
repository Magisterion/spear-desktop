// Keep this sandbox preload self-contained: Electron only permits built-in modules.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('classic', {
  onTab: (callback) =>
    ipcRenderer.on('classic:settings-tab', (_event, tab) => callback(tab)),
  request: (action, value) =>
    ipcRenderer.invoke('classic:local', action, value),
});
