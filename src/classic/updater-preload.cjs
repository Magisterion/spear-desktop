const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('updates', {
  request: (action) => ipcRenderer.invoke('spear:updates', action),
});
