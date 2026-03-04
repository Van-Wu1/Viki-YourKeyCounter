const fs = require('fs');
const path = require('path');
const express = require('express');

// Config
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const COUNT_FILE = process.env.COUNT_FILE || path.join(ROOT_DIR, 'count.ini');
const UI_DIR = path.join(ROOT_DIR, 'ui');
const PORT = process.env.PORT || 3000;

const app = express();

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
    const content = fs.readFileSync(filePath, 'utf8');
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

// Routes
app.get('/api/summary', (req, res) => {
  const countIni = safeReadIni(COUNT_FILE) || {};
  const meta = countIni.Meta || {};
  const total = countIni.Total || {};

  const dayIds = listDayIds();

  res.json({
    currentDayId: meta.DayId || null,
    totals: {
      keyboard: toInt(total.Keyboard),
      mouseLeft: toInt(total.MouseLeft),
      mouseRight: toInt(total.MouseRight),
      wheelUp: toInt(total.WheelUp),
      wheelDown: toInt(total.WheelDown)
    },
    days: dayIds
  });
});

app.get('/api/day/:dayId', (req, res) => {
  const { dayId } = req.params;
  const data = readDay(dayId);
  if (!data) {
    return res.status(404).json({ error: 'day_not_found', dayId });
  }
  res.json(data);
});

app.get('/api/days', (req, res) => {
  const { from, to } = req.query;
  const allIds = listDayIds();
  const filtered = allIds.filter((id) => {
    if (from && id < from) return false;
    if (to && id > to) return false;
    return true;
  });

  const days = filtered
    .map((id) => readDay(id))
    .filter(Boolean);

  res.json({ days });
});

// Serve static UI if present
if (fs.existsSync(UI_DIR)) {
  app.use(express.static(UI_DIR));
}

app.listen(PORT, () => {
  console.log(`KeyCounter API server running at http://localhost:${PORT}`);
});

