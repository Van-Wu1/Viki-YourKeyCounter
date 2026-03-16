const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const APP_ROOT = path.resolve(__dirname, '..');
const apiPort = process.argv[2] || '55555';

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 420,
    height: 600,
    minWidth: 360,
    minHeight: 520,
    frame: false,
    resizable: true,
    transparent: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile(path.join(__dirname, 'login.html'), {
    query: { port: apiPort }
  });

  win.setMenuBarVisibility(false);
  win.setTitle('KeyCounter 登录');

  win.on('closed', () => {
    win = null;
  });
}

ipcMain.on('login-success', () => {
  app.exit(0);
});

ipcMain.on('login-cancel', () => {
  app.exit(1);
});

ipcMain.on('login-minimize', () => {
  if (win && !win.isDestroyed()) win.minimize();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});
