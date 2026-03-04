const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PREFS = { width: 160, height: 70, transparency: 94, borderRadius: 14 };
const GUI_INI = path.join(APP_ROOT, 'gui.ini');
const COUNT_INI = path.join(APP_ROOT, 'count.ini');

function parseIni(filePath) {
  const obj = {};
  if (!fs.existsSync(filePath)) return obj;
  let section = '';
  const buf = fs.readFileSync(filePath);
  let content;
  if (buf[0] === 0xFF && buf[1] === 0xFE) content = buf.toString('utf16le');
  else if (buf[0] === 0xFE && buf[1] === 0xFF) content = buf.toString('utf16be');
  else if (buf.length > 2 && buf[0] === 0 && buf[1] !== 0) content = buf.toString('utf16be');
  else content = buf.toString('utf8');
  content = content.replace(/\r/g, '');
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^\[([^\]]+)\]/);
    if (m) {
      section = m[1];
      obj[section] = obj[section] || {};
    } else {
      const kv = line.trim().match(/^([^=]+)=(.*)$/);
      if (kv && section) {
        obj[section][kv[1].trim()] = kv[2].trim();
      }
    }
  }
  return obj;
}

function getGuiIni() {
  return parseIni(GUI_INI);
}

function getPrefs() {
  const ini = getGuiIni();
  const p = ini.Preferences || {};
  return {
    width: parseInt(p.Width, 10) || DEFAULT_PREFS.width,
    height: parseInt(p.Height, 10) || DEFAULT_PREFS.height,
    transparency: parseInt(p.Transparency, 10) || DEFAULT_PREFS.transparency,
    borderRadius: parseInt(p.BorderRadius, 10) || DEFAULT_PREFS.borderRadius
  };
}

function applyPrefsToWindow(win, prefs) {
  if (!win || win.isDestroyed()) return;
  const key = JSON.stringify(prefs);
  if (lastAppliedPrefs === key) return;
  lastAppliedPrefs = key;
  win.setSize(prefs.width, prefs.height);
  const alpha = Math.max(0.1, Math.min(1, prefs.transparency / 100));
  win.webContents.executeJavaScript(
    `(function(){var w=${prefs.width};var h=${prefs.height};var r=${prefs.borderRadius};var a=${alpha};document.body.style.width=w+'px';document.body.style.height=h+'px';var d=document.getElementById('drag-area');if(d){d.style.borderRadius=r+'px';d.style.background='rgba(240,240,242,'+a+')';}})();`
  ).catch(() => {});
}

function getTodayCounts() {
  const ini = parseIni(COUNT_INI);
  const today = ini.Today || {};
  const kb = parseInt(today.Keyboard, 10) || 0;
  const ml = parseInt(today.MouseLeft, 10) || 0;
  const mr = parseInt(today.MouseRight, 10) || 0;
  const wu = parseInt(today.WheelUp, 10) || 0;
  const wd = parseInt(today.WheelDown, 10) || 0;
  return { keyboard: kb, mouse: ml + mr + wu + wd };
}

let win = null;
let visibilityCheckInterval = null;
let lastAppliedPrefs = null;

function createWindow() {
  const prefs = getPrefs();
  const ini = getGuiIni();
  const floating = ini.Floating || {};
  let x = parseInt(floating.X, 10);
  let y = parseInt(floating.Y, 10);
  const initialVisible = (ini.Floating || {}).Visible;
  if (isNaN(x) || isNaN(y)) {
    const { screen } = require('electron');
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    x = Math.floor((width - prefs.width) / 2);
    y = Math.floor((height - prefs.height) / 2);
  }

  win = new BrowserWindow({
    width: prefs.width,
    height: prefs.height,
    x, y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.setMenuBarVisibility(false);
  win.setTitle('KeyCounter Widget');
  win.loadFile(path.join(__dirname, 'widget.html'));

  win.webContents.once('did-finish-load', () => {
    applyPrefsToWindow(win, prefs);
  });

  const sendCounts = () => {
    if (win && !win.isDestroyed()) {
      try {
        const counts = getTodayCounts();
        win.webContents.send('widget-counts', counts);
        win.webContents.executeJavaScript(
          `(function(){var k=${counts.keyboard},m=${counts.mouse};var ke=document.getElementById('keys-value');var me=document.getElementById('mouse-value');if(ke)ke.textContent=k.toLocaleString();if(me)me.textContent=m.toLocaleString();})();`
        ).catch(() => {});
      } catch (_) {}
    }
  };
  win.webContents.once('did-finish-load', sendCounts);
  const countInterval = setInterval(sendCounts, 500);
  win.on('closed', () => { clearInterval(countInterval); win = null; });

  win.on('moved', () => {
    const [wx, wy] = win.getPosition();
    const obj = parseIni(GUI_INI);
    if (!obj.Floating) obj.Floating = {};
    obj.Floating.X = wx;
    obj.Floating.Y = wy;
    const lines = [];
    for (const [sec, kvs] of Object.entries(obj)) {
      lines.push(`[${sec}]`);
      for (const [k, v] of Object.entries(kvs)) lines.push(`${k}=${v}`);
      lines.push('');
    }
    fs.writeFileSync(GUI_INI, lines.join('\n'));
  });

  if (initialVisible === '0') win.hide();

  visibilityCheckInterval = setInterval(() => {
    const ini = getGuiIni();
    const visible = (ini.Floating || {}).Visible;
    const newPrefs = getPrefs();
    if (!win || win.isDestroyed()) return;
    if (visible === '0') win.hide();
    else win.show();
    applyPrefsToWindow(win, newPrefs);
  }, 500);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (visibilityCheckInterval) clearInterval(visibilityCheckInterval);
  app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
