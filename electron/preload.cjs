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

if (process.argv.includes('--infinishoot-workshop')) contextBridge.exposeInMainWorld('steamWorkshop', {
  list: () => ipcRenderer.invoke('steam:workshop-list'),
  browse: () => ipcRenderer.invoke('steam:workshop-browse'),
  publish: (kind, title, raw) => ipcRenderer.invoke('steam:workshop-publish', kind, title, raw),
});
if (process.argv.includes('--infinishoot-steam-keyboard')) contextBridge.exposeInMainWorld('steamKeyboard',
  (label, limit, value, multi) => ipcRenderer.invoke('steam:keyboard', label, limit, value, multi));
if (process.argv.includes('--infinishoot-deck')) contextBridge.exposeInMainWorld('steamDeck', true);
if (process.argv.includes('--infinishoot-steam')) {
  contextBridge.exposeInMainWorld('steamGame', {
    unlock: ids => ipcRenderer.invoke('steam:unlock', ids),
    presence: (status, code) => ipcRenderer.invoke('steam:presence', status, code),
    onJoin: callback => {
      ipcRenderer.on('steam:join', (_event, code) => callback(code));
      ipcRenderer.invoke('steam:ready').then(code => { if (code) callback(code); });
    },
  });
  // Release held keys/buttons through the game's normal blur handler. No pointer or keyboard grab.
  ipcRenderer.on('steam:overlay', () => window.dispatchEvent(new Event('blur')));
}

// Restore before renderer modules read storage. Only the normalized progression stores travel.
if (process.argv.includes('--infinishoot-cloud')) {
  try {
    const profile = ipcRenderer.sendSync('steam:cloud-read');
    if (profile) {
      const prefix = 'infinishoot.';
      if (profile.switched) for (const key of profile.keys) localStorage.removeItem(prefix + key);
      for (const key of profile.keys) {
        const value = profile.records?.[key];
        if (value !== undefined) localStorage.setItem(prefix + key, value);
        else if (profile.records) localStorage.removeItem(prefix + key);
      }
      ipcRenderer.sendSync('steam:cloud-restored');
      const last = { ...(profile.records ?? {}) };
      function saveCloud() {
        let changed = false;
        const records = {};
        for (const key of profile.keys) {
          const value = localStorage.getItem(prefix + key);
          if (value !== null) records[key] = value;
          if (records[key] !== last[key]) changed = true;
        }
        if (changed && ipcRenderer.sendSync('steam:cloud-write', { version: 1, records })) {
          for (const key of profile.keys) last[key] = records[key];
        }
      }
      if (profile.writable) {
        const interval = setInterval(saveCloud, 5000);
        window.addEventListener('pagehide', () => { clearInterval(interval); saveCloud(); }, { once: true });
      }
    }
  } catch (error) { ipcRenderer.send('desktop:log', 'steam-cloud', String(error)); }
}
