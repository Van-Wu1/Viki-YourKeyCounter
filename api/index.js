const fs = require('fs');
const path = require('path');
const express = require('express');

// Config：优先使用 __dirname 避免中文路径编码问题（KEYCOUNTER_ROOT 经 AHK 传递时可能损坏）
const _dirRoot = path.resolve(__dirname, '..');
const _envRoot = process.env.KEYCOUNTER_ROOT ? path.resolve(process.env.KEYCOUNTER_ROOT) : null;
const ROOT_DIR = (_envRoot && fs.existsSync(path.join(_envRoot, 'data'))) ? _envRoot : _dirRoot;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const COUNT_FILE = process.env.COUNT_FILE || path.join(ROOT_DIR, 'count.ini');
const GUI_INI = process.env.GUI_INI || path.join(ROOT_DIR, 'gui.ini');
const UI_DIR = path.join(ROOT_DIR, 'ui');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

// Simple INI parser (sections + key=value)
function parseIni(content) {
  const lines = content.split(/\r?\n/);
  const result = {};
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1);
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();

    if (!currentSection) currentSection = 'default';
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][key] = value;
  }

  return result;
}

function safeReadIni(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    let content;
    if (buf[0] === 0xFF && buf[1] === 0xFE) content = buf.toString('utf16le');
    else if (buf[0] === 0xFE && buf[1] === 0xFF) content = buf.toString('utf16be');
    else if (buf.length > 2 && buf[0] === 0 && buf[1] !== 0) content = buf.toString('utf16be');
    else content = buf.toString('utf8');
    content = content.replace(/\r/g, '');
    return parseIni(content);
  } catch (e) {
    return null;
  }
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? 0 : n;
}

// Read one day file into normalized JSON
function readDay(dayId) {
  const filePath = path.join(DATA_DIR, `${dayId}.ini`);
  if (!fs.existsSync(filePath)) return null;
  const ini = safeReadIni(filePath);
  if (!ini) return null;

  const day = ini.Day || {};
  const perKey = ini.PerKey || {};

  return {
    dayId,
    totals: {
      keyboard: toInt(day.Keyboard),
      mouseLeft: toInt(day.MouseLeft),
      mouseRight: toInt(day.MouseRight),
      wheelUp: toInt(day.WheelUp),
      wheelDown: toInt(day.WheelDown)
    },
    perKey
  };
}

function listDayIds() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.ini'))
    .map((f) => path.basename(f, '.ini'))
    .sort(); // yyyyMMdd lexicographical sort == chronological
}

// 内存缓存，减少重复文件 I/O（TTL 2 秒，与 AHK FlushSave 节奏一致）
let _dashboardCache = null;
let _dashboardCacheTime = 0;
const CACHE_TTL_MS = 2000;

function invalidateCache() {
  _dashboardCache = null;
}

function getDashboardData() {
  const now = Date.now();
  if (_dashboardCache && (now - _dashboardCacheTime) < CACHE_TTL_MS) {
    return _dashboardCache;
  }
  _dashboardCache = buildDashboardData();
  _dashboardCacheTime = now;
  return _dashboardCache;
}

// 构建 Dashboard 数据（供 /api/data 和 /data.js 共用）
function buildDashboardData() {
  const countIni = safeReadIni(COUNT_FILE) || {};
  const meta = countIni.Meta || {};
  const total = countIni.Total || {};
  const guiIni = safeReadIni(GUI_INI) || {};
  const floating = guiIni.Floating || {};
  const prefs = guiIni.Preferences || {};
  const dayIds = listDayIds();

  const dayData = {};
  for (const id of dayIds) {
    const d = readDay(id);
    if (d) dayData[id] = { totals: d.totals, perKey: d.perKey || {} };
  }

  return {
    currentDayId: meta.DayId || null,
    totals: {
      keyboard: toInt(total.Keyboard),
      mouseLeft: toInt(total.MouseLeft),
      mouseRight: toInt(total.MouseRight),
      wheelUp: toInt(total.WheelUp),
      wheelDown: toInt(total.WheelDown)
    },
    days: dayIds,
    dayData,
    guiIni: {
      Floating: { X: floating.X || '0', Y: floating.Y || '0', Visible: floating.Visible || '1' },
      Preferences: {
        Theme: prefs.Theme || 'light',
        SizePercent: prefs.SizePercent || '30',
        Transparency: prefs.Transparency || '94',
        BorderRadius: prefs.BorderRadius || '14',
        SittingEnabled: prefs.SittingEnabled || '1',
        SittingMinutes: prefs.SittingMinutes || '60',
        TenosynovitisEnabled: (prefs.TenosynovitisEnabled !== undefined && prefs.TenosynovitisEnabled !== '') ? prefs.TenosynovitisEnabled : (prefs.ReminderEnabled || '1'),
        KeyboardThreshold: prefs.KeyboardThreshold || '50000',
        MouseThreshold: prefs.MouseThreshold || '10000',
        WaterEnabled: prefs.WaterEnabled || '1',
        WaterMinutes: prefs.WaterMinutes || '45',
        ReminderCooldown: prefs.ReminderCooldown || '1'
      }
    }
  };
}

// Routes
app.get('/api/summary', (req, res) => {
  const data = getDashboardData();
  res.json({
    currentDayId: data.currentDayId,
    totals: data.totals,
    days: data.days
  });
});

app.get('/api/day/:dayId', (req, res) => {
  const { dayId } = req.params;
  const cached = getDashboardData();
  const d = cached.dayData[dayId];
  if (!d) {
    const data = readDay(dayId);
    if (!data) {
      return res.status(404).json({ error: 'day_not_found', dayId });
    }
    return res.json(data);
  }
  res.json({ dayId, totals: d.totals, perKey: d.perKey || {} });
});

app.get('/api/days', (req, res) => {
  const { from, to } = req.query;
  const cached = getDashboardData();
  const filtered = cached.days.filter((id) => {
    if (from && id < from) return false;
    if (to && id > to) return false;
    return true;
  });

  const days = filtered
    .map((id) => {
      const d = cached.dayData[id];
      return d ? { dayId: id, totals: d.totals, perKey: d.perKey || {} } : null;
    })
    .filter(Boolean);

  res.json({ days });
});

// Full dashboard data (currentDayId, totals, days, dayData, guiIni)
app.get('/api/data', (req, res) => {
  res.json(getDashboardData());
});

// Export all data as JSON
app.get('/api/export', (req, res) => {
  const data = getDashboardData();
  const days = data.days.map((id) => {
    const d = data.dayData[id];
    return d ? { dayId: id, totals: d.totals, perKey: d.perKey || {} } : null;
  }).filter(Boolean);

  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    meta: { DayId: data.currentDayId },
    totals: data.totals,
    days
  };

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="keycounter-export.json"');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(exportData);
});

// Save gui.ini (Preferences)
app.post('/api/prefs', (req, res) => {
  const { content } = req.body;
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content required' });
  }
  try {
    fs.writeFileSync(GUI_INI, content, 'utf8');
    invalidateCache();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'write_failed', message: e.message });
  }
});

// Serve public folder (e.g. moneycome.jpg)
if (fs.existsSync(path.join(ROOT_DIR, 'public'))) {
  app.use('/public', express.static(path.join(ROOT_DIR, 'public')));
}

// Serve static UI if present
if (fs.existsSync(UI_DIR)) {
  app.use(express.static(UI_DIR));
}

app.listen(PORT, () => {
  console.log(`KeyCounter API server running at http://localhost:${PORT}`);
});

