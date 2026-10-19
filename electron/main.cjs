// Unsigned-friendly desktop wrapper: asynchronous release notice, isolated IPC, local diagnostics.
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, screen, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
let win, logic, ring, available = null, checking = null, lastCheck = 0;
let mode = 'windowed', normalBounds, writeTimer, boundsTimer;
const statePath = path.join(app.getPath('userData'), 'desktop.json');
const logPath = path.join(app.getPath('userData'), 'errors.json');
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const savedState = read(statePath, {});
const state = savedState && typeof savedState === 'object' && !Array.isArray(savedState) ? savedState : {};
// Chromium presentation switches are startup-only. UI marks VSync as restart-required.
if (state.options?.vsync === false) {
  app.commandLine.appendSwitch('disable-gpu-vsync');
  app.commandLine.appendSwitch('disable-frame-rate-limit');
}
const activeVsync = state.options?.vsync !== false;
function write(file, value) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(value)); fs.renameSync(file + '.tmp', file); } catch { /* Read-only/full disks must never prevent play. */ }
}
function flush() { clearTimeout(writeTimer); writeTimer = null; if (ring) write(logPath, ring.entries); }
function log(kind, message, urgent = false) {
  if (!ring) return;
  ring.add(kind, message);
  if (urgent) flush();
  else if (!writeTimer) writeTimer = setTimeout(() => { writeTimer = null; flush(); }, 250);
}
process.on('uncaughtExceptionMonitor', (error) => log('main-crash', error, true));
process.on('unhandledRejection', (error) => log('main-rejection', error, true));
function persist() { state.bounds = normalBounds; state.options.windowMode = mode; write(statePath, state); }
function notifyMode() { if (win && !win.isDestroyed()) win.webContents.send('desktop:mode', mode); }
function setMode(next) {
  if (!win || next === mode) return;
  if (mode === 'windowed') normalBounds = win.getNormalBounds();
  if (process.platform === 'darwin' && mode === 'borderless') win.setSimpleFullScreen(false);
  mode = next;
  const applyBounds = () => {
    if (mode === 'borderless') {
      if (process.platform === 'darwin') win.setSimpleFullScreen(true);
      else win.setBounds(screen.getDisplayMatching(normalBounds || win.getBounds()).bounds);
    }
    else if (mode === 'windowed' && normalBounds) win.setBounds(normalBounds);
    persist(); notifyMode();
  };
  if (win.isFullScreen() && next !== 'fullscreen') {
    win.once('leave-full-screen', applyBounds);
    win.setFullScreen(false);
  } else if (next === 'fullscreen') win.setFullScreen(true);
  else applyBounds();
  persist(); notifyMode();
}
function trusted(event) { return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame; }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => trusted(event) ? fn(...args) : null); }
function context() { return { version: app.getVersion(), os: `${os.platform()} ${os.release()} ${os.arch()}`, settings: state.settings || {}, display: state.options, activeVsync }; }
async function checkUpdate() {
  if (!state.options.autoUpdate || !app.isPackaged) return null;
  if (checking) return checking;
  if (Date.now() - lastCheck < 60_000) return available;
  lastCheck = Date.now();
  checking = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await net.fetch('https://api.github.com/repos/MohamadHazeem/Infinishoot/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Update check HTTP ${response.status}`);
      available = logic.availableRelease(app.getVersion(), await response.json());
      return state.options.autoUpdate ? available : null;
    } catch (error) { log('update', error); return null; }
    finally { clearTimeout(timeout); checking = null; }
  })();
  return checking;
}
function createWindow() {
  const display = screen.getPrimaryDisplay().workArea;
  const b = state.bounds;
  const valid = b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && screen.getAllDisplays().some(d => b.x < d.workArea.x + d.workArea.width && b.x + b.width > d.workArea.x && b.y < d.workArea.y + d.workArea.height && b.y + b.height > d.workArea.y);
  const area = valid ? screen.getDisplayMatching(b).workArea : display;
  const width = Math.max(640, Math.min(valid ? b.width : 1280, area.width));
  const height = Math.max(360, Math.min(valid ? b.height : 800, area.height));
  normalBounds = { width, height, x: valid ? Math.max(area.x, Math.min(b.x, area.x + area.width - width)) : area.x + Math.round((area.width - width) / 2), y: valid ? Math.max(area.y, Math.min(b.y, area.y + area.height - height)) : area.y + Math.round((area.height - height) / 2) };
  win = new BrowserWindow({ ...normalBounds, minWidth: 640, minHeight: 360, frame: false, backgroundColor: '#1a1c2c', title: 'InfiniShoot', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  const initialMode = state.options.windowMode;
  setMode(initialMode);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  for (const event of ['resize', 'move']) win.on(event, () => {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && mode === 'windowed' && !win.isMaximized() && !win.isFullScreen()) { normalBounds = win.getBounds(); persist(); }
    }, 200);
  });
  win.on('close', () => {
    clearTimeout(boundsTimer);
    if (mode === 'windowed' && !win.isMaximized() && !win.isFullScreen()) normalBounds = win.getBounds();
    persist();
  });
  win.on('enter-full-screen', () => { mode = 'fullscreen'; persist(); notifyMode(); });
  win.on('leave-full-screen', () => { if (mode === 'fullscreen') mode = 'windowed'; persist(); notifyMode(); });
  win.webContents.on('render-process-gone', (_event, details) => log('renderer-crash', details, true));
  win.on('unresponsive', () => log('unresponsive', 'Renderer did not respond', true));
  win.webContents.on('console-message', (details) => { if (details.level === 'error') log('console', details.message); });
  win.webContents.on('did-fail-load', (_event, code, description) => log('load', `${code} ${description}`, true));
  win.webContents.session.on('will-download', (_event, item) => {
    const dir = process.env.INFINISHOOT_SAVE_DIR;
    const photo = item.getFilename().toLowerCase().endsWith('.png');
    const video = item.getFilename().toLowerCase().endsWith('.webm');
    if (dir) item.setSavePath(path.join(dir, path.basename(item.getFilename())));
    else item.setSaveDialogOptions({ title: 'Save InfiniShoot file', defaultPath: path.join(app.getPath(video ? 'videos' : photo ? 'pictures' : 'documents'), item.getFilename()) });
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && !input.isAutoRepeat && (input.key === 'F11' || (input.meta && input.control && input.key.toLowerCase() === 'f'))) {
      setMode(mode === 'fullscreen' ? 'windowed' : 'fullscreen'); event.preventDefault();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (url.startsWith('https://')) void shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}
void import('./logic.mjs').then((module) => {
  logic = module;
  ring = new logic.LogRing(read(logPath, []));
  state.options = logic.displayOptions(state.options);
  handle('desktop:info', () => ({ version: app.getVersion(), os: `${os.platform()} ${os.release()} ${os.arch()}`, activeVsync, windowMode: mode }));
  handle('desktop:configure', (options, settings) => {
    const next = logic.displayOptions(options);
    state.options = next;
    // No names, room codes, save content or relay credentials in reports.
    state.settings = {};
    if (settings && typeof settings === 'object') for (const [key, value] of Object.entries(settings)) {
      if (/name|loadout|look|skin|pet|hero|token|password|credential|relay|authorization/i.test(key)) continue;
      if (typeof value === 'boolean' || typeof value === 'number' || (typeof value === 'string' && value.length <= 24 && /^[a-z0-9-]+$/i.test(value))) state.settings[key] = value;
    }
    setMode(next.windowMode); persist();
    return { restartRequired: activeVsync !== next.vsync };
  });
  handle('desktop:update', checkUpdate);
  handle('desktop:release', async () => { if (available && state.options.autoUpdate) await shell.openExternal(available.url); });
  ipcMain.on('desktop:log', (event, kind, message) => { if (trusted(event)) log(String(kind), message); });
  handle('desktop:export', async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Export InfiniShoot error log', defaultPath: path.join(app.getPath('documents'), 'InfiniShoot-error-log.txt'), filters: [{ name: 'Text', extensions: ['txt'] }] });
    if (result.canceled || !result.filePath) return 'cancelled';
    try { await fs.promises.writeFile(result.filePath, ring.text(context()), 'utf8'); return 'saved'; }
    catch (error) { log('export', error); return 'failed'; }
  });
  handle('desktop:window', (action) => {
    if (action === 'minimize') win.minimize();
    if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    if (action === 'close') win.close();
  });
  return app.whenReady();
}).then(() => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { label: 'View', submenu: [{ label: 'Toggle Fullscreen', accelerator: 'Control+Command+F', click: () => setMode(mode === 'fullscreen' ? 'windowed' : 'fullscreen') }] }]) : null);
  app.on('child-process-gone', (_event, details) => log('process-crash', details, true));
  log('session', context());
  require('./mods.cjs').registerMods(app);
  createWindow();
});
app.on('before-quit', flush);
app.on('window-all-closed', () => app.quit());
