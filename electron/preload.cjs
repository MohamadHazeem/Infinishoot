const { contextBridge, ipcRenderer } = require('electron');
// Deliberately narrow: no filesystem, arbitrary URLs, or generic IPC exposed to game code.
contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  configure: (options, settings) => ipcRenderer.invoke('desktop:configure', options, settings),
  checkUpdate: () => ipcRenderer.invoke('desktop:update'),
  openRelease: () => ipcRenderer.invoke('desktop:release'),
  log: (kind, message) => ipcRenderer.send('desktop:log', kind, message),
  exportLog: () => ipcRenderer.invoke('desktop:export'),
  windowAction: (action) => ipcRenderer.invoke('desktop:window', action),
  onWindowMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('desktop:mode', listener);
    return () => ipcRenderer.removeListener('desktop:mode', listener);
  },
});
// Content mods (src/mods): list the mods folder and open it.
contextBridge.exposeInMainWorld('infiniMods', {
  list: () => ipcRenderer.invoke('mods:list'),
  openFolder: () => ipcRenderer.invoke('mods:folder'),
});
