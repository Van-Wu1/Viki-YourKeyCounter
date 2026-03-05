const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname, '..');
const WIDGET_CMD_FILE = path.join(APP_ROOT, 'keycounter_widget_cmd.txt');
const DEFAULT_PREFS = { width: 160, height: 70, transparency: 94, borderRadius: 14 };
const GUI_INI = path.join(APP_ROOT, 'gui.ini');
const COUNT_INI = path.join(APP_ROOT, 'count.ini');
const HEALTH_STATUS_INI = path.join(APP_ROOT, 'health_status.ini');

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
    borderRadius: parseInt(p.BorderRadius, 10) || DEFAULT_PREFS.borderRadius,
    sittingEnabled: p.SittingEnabled !== '0',
    sittingMinutes: parseInt(p.SittingMinutes, 10) || 120,
    tenosynovitisEnabled: p.TenosynovitisEnabled !== '0',
    keyboardThreshold: parseInt(p.KeyboardThreshold, 10) || 0,
    mouseThreshold: parseInt(p.MouseThreshold, 10) || 0,
    waterEnabled: p.WaterEnabled !== '0',
    waterMinutes: parseInt(p.WaterMinutes, 10) || 45
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

function getHealthStatus() {
  const ini = parseIni(HEALTH_STATUS_INI);
  const s = ini.Status || {};
  return {
    sitting: s.Sitting === '1',
    tenosynovitis: s.Tenosynovitis === '1',
    water: s.Water === '1'
  };
}

let win = null;
let tickInterval = null;
let lastAppliedPrefs = null;
let lastCountsStr = '';
let lastHealthStatusStr = '';

function createWindow() {
  const prefs = getPrefs();
  const ini = getGuiIni();
  const floating = ini.Floating || {};
  let x = parseInt(floating.X, 10);
  let y = parseInt(floating.Y, 10);
  const initialVisible = (ini.Floating || {}).Visible;
  if (isNaN(x) || isNaN(y)) {
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
  win.setTitle('Viki Widget');
  win.loadFile(path.join(__dirname, 'widget.html'));

  function writeWidgetCmd(cmd) {
    try { fs.writeFileSync(WIDGET_CMD_FILE, cmd); } catch (_) {}
  }

  let lastContextMenu = null;
  let overlayWins = [];

  function closeContextMenuAndOverlay() {
    ipcMain.removeListener('overlay-clicked', closeContextMenuAndOverlay);
    if (lastContextMenu && win && !win.isDestroyed()) {
      lastContextMenu.closePopup(win);
      lastContextMenu = null;
    }
    for (const ow of overlayWins) {
      if (ow && !ow.isDestroyed()) ow.destroy();
    }
    overlayWins = [];
  }

  function showWidgetContextMenu(screenX, screenY) {
    const menu = Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => writeWidgetCmd('OpenDashboard') },
      { label: 'Preferences', click: () => writeWidgetCmd('Preferences') },
      { type: 'separator' },
      { label: 'Update check', click: () => writeWidgetCmd('UpdateCheck') },
      { label: 'Open source', click: () => writeWidgetCmd('OpenSource') },
      { type: 'separator' },
      { label: 'Reset', click: () => writeWidgetCmd('Reset') }
    ]);
    lastContextMenu = menu;
    menu.on('menu-will-close', () => { closeContextMenuAndOverlay(); });

    const displays = screen.getAllDisplays();
    overlayWins = displays.map((d) => {
      const b = d.bounds;
      const ow = new BrowserWindow({
        x: b.x, y: b.y, width: b.width, height: b.height,
        frame: false, transparent: true, alwaysOnTop: true, skipTaskbar: true,
        focusable: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
      });
      ow.setIgnoreMouseEvents(false);
      ow.loadFile(path.join(__dirname, 'overlay.html'));
      return ow;
    });

    let shown = 0;
    const tryShowMenu = () => {
      shown++;
      if (shown >= overlayWins.length) {
        if (screenX != null && screenY != null && !isNaN(screenX) && !isNaN(screenY)) {
          menu.popup({ window: win, x: Math.round(screenX), y: Math.round(screenY) });
        } else {
          menu.popup({ window: win });
        }
      }
    };
    overlayWins.forEach((ow) => {
      ow.once('ready-to-show', () => {
        ow.show();
        tryShowMenu();
      });
    });

    ipcMain.once('overlay-clicked', closeContextMenuAndOverlay);
    win.webContents.send('widget-context-menu-shown');
  }

  ipcMain.on('widget-close-context-menu', closeContextMenuAndOverlay);

  win.on('system-context-menu', (e, point) => {
    e.preventDefault();
    const x = point?.x != null ? Math.round(point.x) : null;
    const y = point?.y != null ? Math.round(point.y) : null;
    showWidgetContextMenu(x, y);
  });

  win.webContents.once('did-finish-load', () => {
    applyPrefsToWindow(win, prefs);
  });

  const tick = () => {
    if (!win || win.isDestroyed()) return;
    try {
      const counts = getTodayCounts();
      const countsStr = counts.keyboard + ',' + counts.mouse;
      const health = getHealthStatus();
      const healthStr = JSON.stringify(health);
      if (countsStr !== lastCountsStr || healthStr !== lastHealthStatusStr) {
        lastCountsStr = countsStr;
        lastHealthStatusStr = healthStr;
        win.webContents.send('widget-counts', counts);
        win.webContents.executeJavaScript(
          `(function(){var k=${counts.keyboard},m=${counts.mouse};var ke=document.getElementById('keys-value');var me=document.getElementById('mouse-value');if(ke)ke.textContent=k.toLocaleString();if(me)me.textContent=m.toLocaleString();var s=document.getElementById('dot-sitting');var t=document.getElementById('dot-tenosynovitis');var w=document.getElementById('dot-water');if(s){if(${health.sitting})s.classList.add('active');else s.classList.remove('active');}if(t){if(${health.tenosynovitis})t.classList.add('active');else t.classList.remove('active');}if(w){if(${health.water})w.classList.add('active');else w.classList.remove('active');}})();`
        ).catch(() => {});
      }
      const ini = getGuiIni();
      const visible = (ini.Floating || {}).Visible;
      const newPrefs = getPrefs();
      if (visible === '0') win.hide();
      else win.show();
      applyPrefsToWindow(win, newPrefs);
    } catch (_) {}
  };
  win.webContents.once('did-finish-load', tick);
  tickInterval = setInterval(tick, 500);
  win.on('closed', () => { clearInterval(tickInterval); win = null; });


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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (tickInterval) clearInterval(tickInterval);
  app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
