// Desktop wrapper: opens the built game (dist/index.html) in its own window.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: '#000000',
    title: 'InfiniShoot',
    autoHideMenuBar: true,
    webPreferences: {
      // Keep the game running when the window is in the background, so an online host never pauses everyone.
      backgroundThrottling: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // "Save to file" asks where to put the save, starting in Documents; photo mode PNGs start in Pictures.
  // INFINISHOOT_SAVE_DIR skips the dialog (used for automated checks).
  win.webContents.session.on('will-download', (_event, item) => {
    const dir = process.env.INFINISHOOT_SAVE_DIR;
    const photo = item.getFilename().toLowerCase().endsWith('.png');
    if (dir) item.setSavePath(path.join(dir, item.getFilename()));
    else
      item.setSaveDialogOptions({
        title: photo ? 'Save InfiniShoot photo' : 'Save InfiniShoot progress',
        defaultPath: path.join(app.getPath(photo ? 'pictures' : 'documents'), item.getFilename()),
      });
  });

  // F11 (or Ctrl+Cmd+F on a Mac) toggles fullscreen.
  win.webContents.on('before-input-event', (event, input) => {
    const macFull = input.meta && input.control && input.key.toLowerCase() === 'f';
    if (input.type === 'keyDown' && (input.key === 'F11' || macFull)) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Links open in the normal browser, never inside the game window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

// No menu bar on Windows. macOS keeps a minimal app menu so Cmd+Q and Cmd+H work.
Menu.setApplicationMenu(
  process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }] }]) : null,
);
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
