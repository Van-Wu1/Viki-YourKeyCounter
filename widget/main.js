const { app, BrowserWindow, Menu, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname, '..');
const WIDGET_CMD_FILE = path.join(APP_ROOT, 'keycounter_widget_cmd.txt');
const WIDGET_PID_FILE = path.join(APP_ROOT, 'keycounter_widget_pid.txt');
// 基准尺寸：宽 270，高 45，对应 SizePercent=30
const SIZE_BASE_W = 230;
const SIZE_BASE_H = 45;
const SIZE_BASE_PCT = 30;
const DEFAULT_PREFS = { width: 270, height: 45, transparency: 94, borderRadius: 14 };
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
  let sizePercent = parseInt(p.SizePercent, 10);
  if (isNaN(sizePercent) || sizePercent < 5 || sizePercent > 100) {
    const oldW = parseInt(p.Width, 10);
    sizePercent = oldW ? Math.round((oldW / SIZE_BASE_W) * SIZE_BASE_PCT / 5) * 5 : SIZE_BASE_PCT;
    sizePercent = Math.max(5, Math.min(100, sizePercent));
  }
  const width = Math.round(SIZE_BASE_W * sizePercent / SIZE_BASE_PCT);
  const height = Math.round(SIZE_BASE_H * sizePercent / SIZE_BASE_PCT);
  return {
    width,
    height,
    theme: (p.Theme || 'light').toLowerCase() === 'dark' ? 'dark' : 'light',
    transparency: (() => { const v = parseInt(p.Transparency, 10); return (isNaN(v) || v < 0) ? DEFAULT_PREFS.transparency : v; })(),
    borderRadius: (() => { const v = parseInt(p.BorderRadius, 10); return (isNaN(v) || v < 0) ? DEFAULT_PREFS.borderRadius : v; })(),
    sittingEnabled: p.SittingEnabled !== '0',
    sittingMinutes: parseInt(p.SittingMinutes, 10) || 60,
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
  const alpha = Math.max(0, Math.min(1, prefs.transparency / 100));
  const w = prefs.width;
  const h = prefs.height;
  const r = prefs.borderRadius;
  const scale = prefs.width / SIZE_BASE_W;
  const theme = prefs.theme || 'light';
  const bgRgba = theme === 'dark' ? `rgba(30,30,35,${alpha})` : `rgba(240,240,242,${alpha})`;
  win.webContents.executeJavaScript(
    `(function(){var w=${w};var h=${h};var r=${r};var s=${scale};var theme='${theme}';var bgRgba='${bgRgba}';var root=document.documentElement;var body=document.body;var d=document.getElementById('drag-area');var bg=document.getElementById('card-bg');root.setAttribute('data-theme',theme);[root,body,d].forEach(function(el){if(el){el.style.setProperty('--widget-w',w+'px');el.style.setProperty('--widget-h',h+'px');el.style.setProperty('--widget-scale',s);el.style.setProperty('--widget-radius',r+'px');}});if(body){body.style.width=w+'px';body.style.height=h+'px';}if(d){d.style.borderRadius=r+'px';}if(bg){bg.style.background=bgRgba;}})();`
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
  const sitting = String(s.Sitting || '0');
  return {
    sitting,
    sittingRed: sitting === '1',
    sittingGreen: sitting === '2',
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
  win.setTitle('KeyCounter Widget');
  win.loadFile(path.join(__dirname, 'widget.html'));

  function writeWidgetCmd(cmd) {
    try { fs.writeFileSync(WIDGET_CMD_FILE, cmd); } catch (_) {}
  }

  function toggleThemeAndApply() {
    const ini = getGuiIni();
    if (!ini.Preferences) ini.Preferences = {};
    const current = (ini.Preferences.Theme || 'light').toLowerCase();
    const next = current === 'dark' ? 'light' : 'dark';
    ini.Preferences.Theme = next;
    const lines = [];
    for (const [sec, kvs] of Object.entries(ini)) {
      lines.push(`[${sec}]`);
      for (const [k, v] of Object.entries(kvs)) lines.push(`${k}=${v}`);
      lines.push('');
    }
    try { fs.writeFileSync(GUI_INI, lines.join('\n')); } catch (_) {}
    lastAppliedPrefs = null;
    const prefs = getPrefs();
    if (win && !win.isDestroyed()) applyPrefsToWindow(win, prefs);
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
    const isDark = (getGuiIni().Preferences || {}).Theme === 'dark';
    const menu = Menu.buildFromTemplate([
      { label: 'Open Dashboard', click: () => writeWidgetCmd('OpenDashboard') },
      { label: 'Preferences', click: () => writeWidgetCmd('Preferences') },
      { type: 'separator' },
      { label: isDark ? '切换浅色模式' : '切换深色模式', click: toggleThemeAndApply },
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
    if (initialVisible !== '0') {
      win.setAlwaysOnTop(true);
      win.moveTop();
    }
  });

  const tick = () => {
    if (!win || win.isDestroyed()) return;
    try {
      const counts = getTodayCounts();
      const countsStr = counts.keyboard + ',' + counts.mouse;
      const health = getHealthStatus();
      const healthStr = JSON.stringify(health);
      if (countsStr !== lastCountsStr || healthStr !== lastHealthStatusStr) {
        const healthChanged = healthStr !== lastHealthStatusStr;
        lastCountsStr = countsStr;
        lastHealthStatusStr = healthStr;
        win.webContents.send('widget-counts', counts);
        win.webContents.executeJavaScript(
          `(function(){var k=${counts.keyboard},m=${counts.mouse};var ke=document.getElementById('keys-value');var me=document.getElementById('mouse-value');if(ke)ke.textContent=k.toLocaleString();if(me)me.textContent=m.toLocaleString();var s=document.getElementById('dot-sitting');var t=document.getElementById('dot-tenosynovitis');var w=document.getElementById('dot-water');var sittingRed=${health.sittingRed};var sittingGreen=${health.sittingGreen};var any=sittingRed||sittingGreen||${health.tenosynovitis}||${health.water};var parent=document.querySelector('.health-dots');if(parent){if(any)parent.classList.add('has-active');else parent.classList.remove('has-active');}if(s){if(sittingRed||sittingGreen){s.classList.add('active');if(sittingGreen)s.classList.add('resting');else s.classList.remove('resting');if(sittingRed)s.classList.add('blink');else s.classList.remove('blink');}else{s.classList.remove('active','resting','blink');}}if(t){if(${health.tenosynovitis}){t.classList.add('active','blink');}else{t.classList.remove('active','blink');}}if(w){if(${health.water}){w.classList.add('active','blink');}else{w.classList.remove('active','blink');}}if(parent&&${healthChanged}){var blinkers=parent.querySelectorAll('.blink');if(blinkers.length){blinkers.forEach(function(el){el.style.animation='none';});parent.offsetHeight;blinkers.forEach(function(el){el.style.animation='';});}}})();`
        ).catch(() => {});
      }
      const ini = getGuiIni();
      const visible = (ini.Floating || {}).Visible;
      const newPrefs = getPrefs();
      if (visible === '0') win.hide();
      else {
        win.show();
        win.setAlwaysOnTop(true);
        win.moveTop();
      }
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
    // 多显示器 DPI 不同时，移动后强制重设尺寸以修复灯带被裁剪
    lastAppliedPrefs = null;
    const prefs = getPrefs();
    setTimeout(() => {
      if (win && !win.isDestroyed()) {
        win.setSize(prefs.width, prefs.height);
        applyPrefsToWindow(win, prefs);
      }
    }, 50);
  });

  if (initialVisible === '0') win.hide();
}

app.whenReady().then(() => {
  try { fs.writeFileSync(WIDGET_PID_FILE, String(process.pid), 'utf8'); } catch (_) {}
  createWindow();
});

app.on('window-all-closed', () => {
  if (tickInterval) clearInterval(tickInterval);
  app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});
