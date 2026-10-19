const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('infiniMods', {
  list: () => ipcRenderer.invoke('mods:list'),
  openFolder: () => ipcRenderer.invoke('mods:folder'),
});
