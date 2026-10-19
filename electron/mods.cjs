// Narrow desktop bridge: only JSON files in this app's userData/mods, never arbitrary renderer paths.
const { ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const LIMIT = 512 * 1024;
async function readMods(folder) {
  const result = { path: folder, files: [] };
  try {
    await fs.mkdir(folder, { recursive: true });
    const names = (await fs.readdir(folder)).filter(n => n.toLowerCase().endsWith('.json')).sort();
    if (names.length > 32) result.error = 'Only the first 32 JSON files in the mods folder are loaded.';
    let total = 0;
    for (const name of names.slice(0, 32)) {
      const file = { name, raw: '' };
      try {
        const full = path.join(folder, name);
        const stat = await fs.lstat(full);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Expected a regular JSON file; symlinks are not loaded');
        if (stat.size > LIMIT || total + stat.size > 4 * 1024 * 1024) throw new Error('File/library size limit exceeded (512 KiB / 4 MiB)');
        total += stat.size;
        const handle = await fs.open(full, require('node:fs').constants.O_RDONLY | (require('node:fs').constants.O_NOFOLLOW || 0));
        try {
          const buffer = Buffer.alloc(LIMIT + 1);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
          if (bytesRead > LIMIT) throw new Error('File grew beyond 512 KiB while reading');
          file.raw = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
        } finally { await handle.close(); }
      } catch (e) { file.error = e.message; }
      result.files.push(file);
    }
  } catch (e) { result.error = e.message; }
  return result;
}
function registerMods(app) {
  const folder = path.join(app.getPath('userData'), 'mods');
  ipcMain.handle('mods:list', () => readMods(folder));
  ipcMain.handle('mods:folder', async () => { await fs.mkdir(folder, { recursive: true }); const error = await shell.openPath(folder); if (error) throw new Error(error); });
}
module.exports = { registerMods, readMods };
