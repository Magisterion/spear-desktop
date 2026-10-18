import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('classic', {
  request: (action: string, value?: unknown) =>
    ipcRenderer.invoke('classic:local', action, value),
});
