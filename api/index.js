const fs = require('fs');
const path = require('path');
// 加载根目录 .env，供 SUPABASE_* 等环境变量使用
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

// Config：优先使用 __dirname 避免中文路径编码问题（KEYCOUNTER_ROOT 经 AHK 传递时可能损坏）
const _dirRoot = path.resolve(__dirname, '..');
const _envRoot = process.env.KEYCOUNTER_ROOT ? path.resolve(process.env.KEYCOUNTER_ROOT) : null;
const ROOT_DIR = (_envRoot && fs.existsSync(path.join(_envRoot, 'data'))) ? _envRoot : _dirRoot;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const COUNT_FILE = process.env.COUNT_FILE || path.join(ROOT_DIR, 'count.ini');
const GUI_INI = process.env.GUI_INI || path.join(ROOT_DIR, 'gui.ini');
const UI_DIR = path.join(ROOT_DIR, 'ui');
const PORT = process.env.PORT || 3000;

// Supabase 配置（来自根目录 .env）
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase = null;
let supabaseAdmin = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  });
} else {
  console.warn('[cloud] SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY 未全部配置，本地 API 将仅提供本地数据接口。');
}

// 简单的“当前登录用户”状态（单用户桌面场景足够）
let currentUser = null; // { id, email }
let currentDevice = null; // { id, deviceKey, displayName }
let currentPlan = null; // { plan, deviceLimit, retentionDays }

// 持久会话（记住我）
const SESSION_FILE = path.join(ROOT_DIR, 'cloud_session.json');
function loadSavedSession() {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const raw = fs.readFileSync(SESSION_FILE, 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.refresh_token && obj.access_token) return obj;
  } catch (_) {}
  return null;
}
function saveSession(session) {
  if (!session) return;
  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    token_type: session.token_type
  };
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(payload, null, 2), 'utf8'); } catch (_) {}
}
function clearSession() {
  try { if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE); } catch (_) {}
}

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

// 本机 device_key 持久化位置
const DEVICE_FILE = path.join(ROOT_DIR, 'device_id.ini');

function loadOrCreateDeviceKey() {
  try {
    if (fs.existsSync(DEVICE_FILE)) {
      const raw = fs.readFileSync(DEVICE_FILE, 'utf8').trim();
      if (raw) return raw;
    }
  } catch (_) {
    // ignore and fall through to generate
  }
  // 生成一个简单的随机 key（已足够定位设备，不用于安全）
  const key = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  try {
    fs.writeFileSync(DEVICE_FILE, key, 'utf8');
  } catch (_) {
    // 失败也无所谓，下次再生成
  }
  return key;
}

const LOCAL_DEVICE_KEY = loadOrCreateDeviceKey();

// -------- Cloud helpers (Supabase) --------
async function ensureUserPlan(userId) {
  if (!supabaseAdmin) return null;
  // 先查是否已有记录
  const { data, error } = await supabaseAdmin
    .from('user_plans')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    // 非“无记录”错误，直接抛出
    throw error;
  }

  if (data) return data;

  // 没有记录时，按 Free 计划初始化
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('user_plans')
    .insert({
      user_id: userId,
      plan: 'free',
      device_limit: 1,
      retention_days: 90
    })
    .select('*')
    .single();

  if (insertError) {
    throw insertError;
  }
  return inserted;
}

function mapPlanRow(planRow) {
  if (!planRow) return null;
  return {
    plan: planRow.plan,
    deviceLimit: planRow.device_limit,
    retentionDays: planRow.retention_days
  };
}

async function refreshCurrentIdentityFromSession() {
  if (!supabase || !supabaseAdmin) return false;
  const saved = loadSavedSession();
  if (!saved) return false;
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token
    });
    if (error || !data || !data.session || !data.user) {
      return false;
    }
    // session 可能被刷新，落盘
    saveSession(data.session);
    const u = data.user;
    currentUser = { id: u.id, email: u.email, displayName: u.user_metadata?.display_name || u.email };
    const planRow = await ensureUserPlan(data.user.id);
    currentPlan = mapPlanRow(planRow);
    try {
      await registerOrLoadDeviceForCurrentUser('This Device');
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

async function getActiveDeviceCount(userId) {
  if (!supabaseAdmin) return 0;
  const { count, error } = await supabaseAdmin
    .from('devices')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('disabled_at', null);
  if (error) throw error;
  return count || 0;
}

async function registerOrLoadDeviceForCurrentUser(defaultName) {
  if (!supabaseAdmin || !currentUser) return null;
  // 先按 device_key 查
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('devices')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('device_key', LOCAL_DEVICE_KEY)
    .limit(1)
    .maybeSingle();

  if (!existingErr && existing) {
    currentDevice = {
      id: existing.id,
      deviceKey: existing.device_key,
      displayName: existing.display_name
    };
    return currentDevice;
  }

  // 没有记录，需要检查 plan 限制并注册新设备
  const planRow = await ensureUserPlan(currentUser.id);
  const limit = planRow?.device_limit ?? 1;
  const activeCount = await getActiveDeviceCount(currentUser.id);
  if (activeCount >= limit) {
    const err = new Error('device_limit_exceeded');
    err.code = 'device_limit_exceeded';
    throw err;
  }

  const displayName = defaultName || 'My Device';
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('devices')
    .insert({
      user_id: currentUser.id,
      device_key: LOCAL_DEVICE_KEY,
      display_name: displayName,
      last_seen_at: new Date().toISOString()
    })
    .select('*')
    .single();

  if (insertErr) throw insertErr;

  currentDevice = {
    id: inserted.id,
    deviceKey: inserted.device_key,
    displayName: inserted.display_name
  };
  return currentDevice;
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
        Language: prefs.Language || 'zh',
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
// Cloud health（检查本地是否配置了 Supabase）
app.get('/api/cloud/health', (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.json({ ok: false, reason: 'supabase_not_configured' });
  }
  res.json({ ok: true });
});

// Cloud bootstrap: 尝试用本地保存的 session 自动恢复登录态（记住我）
app.post('/api/cloud/bootstrap', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  const ok = await refreshCurrentIdentityFromSession();
  res.json({ ok });
});

// Cloud login：邮箱+密码，通过 Supabase Auth 登录，并确保 user_plans 存在
app.post('/api/cloud/login', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data || !data.user) {
      return res.status(401).json({ error: 'invalid_credentials', details: error && error.message });
    }
    if (data.session) saveSession(data.session);
    const user = data.user;
    currentUser = { id: user.id, email: user.email, displayName: user.user_metadata?.display_name || user.email };
    currentDevice = null;
    let planRow = null;
    try {
      planRow = await ensureUserPlan(user.id);
    } catch (planErr) {
      console.warn('[cloud] ensureUserPlan failed:', planErr);
    }
    // 同步本机设备信息（若超出设备上限，将在前端提示）
    let devicePayload = null;
    try {
      const device = await registerOrLoadDeviceForCurrentUser(req.body.deviceName || 'This Device');
      if (device) {
        devicePayload = {
          id: device.id,
          deviceKey: device.deviceKey,
          displayName: device.displayName,
          isCurrentDevice: true
        };
      }
    } catch (devErr) {
      if (devErr && devErr.code === 'device_limit_exceeded') {
        devicePayload = { error: 'device_limit_exceeded' };
      } else {
        console.warn('[cloud] registerOrLoadDeviceForCurrentUser failed:', devErr);
      }
    }

    currentPlan = mapPlanRow(planRow);
    const displayName = user.user_metadata?.display_name || user.email;
    res.json({
      ok: true,
      user: { id: user.id, email: user.email, user_metadata: user.user_metadata, displayName },
      plan: planRow
        ? {
            plan: planRow.plan,
            deviceLimit: planRow.device_limit,
            retentionDays: planRow.retention_days
          }
        : null,
      device: devicePayload,
      localDeviceKey: LOCAL_DEVICE_KEY
    });
  } catch (e) {
    console.error('[cloud] login error', e);
    res.status(500).json({ error: 'login_failed', message: e.message });
  }
});

// Cloud register：邮箱+密码+昵称，Supabase signUp（需邮箱验证）
app.post('/api/cloud/register', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  const { email, password, displayName } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email_and_password_required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password_too_short', message: '密码至少 6 位' });
  }
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName || email },
        emailRedirectTo: process.env.SUPABASE_EMAIL_REDIRECT || undefined
      }
    });
    if (error) {
      return res.status(400).json({ error: error.message, message: error.message });
    }
    if (data?.user && !data.user.identities?.length) {
      return res.status(400).json({ error: 'email_already_registered', message: '该邮箱已注册' });
    }
    res.json({ ok: true, message: '验证邮件已发送，请查收' });
  } catch (e) {
    console.error('[cloud] register error', e);
    res.status(500).json({ error: 'register_failed', message: e.message });
  }
});

// Cloud forgot-password：发送重置邮件
app.post('/api/cloud/forgot-password', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'email_required' });
  }
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: process.env.SUPABASE_EMAIL_REDIRECT || undefined
    });
    if (error) {
      return res.status(400).json({ error: error.message, message: error.message });
    }
    res.json({ ok: true, message: '重置邮件已发送' });
  } catch (e) {
    console.error('[cloud] forgot-password error', e);
    res.status(500).json({ error: 'forgot_failed', message: e.message });
  }
});

app.post('/api/cloud/logout', (req, res) => {
  currentUser = null;
  currentDevice = null;
  currentPlan = null;
  clearSession();
  res.json({ ok: true });
});

// 退出登录并触发 AHK 重启到登录界面（关闭悬浮框和面板）
const WIDGET_CMD_FILE = path.join(ROOT_DIR, 'keycounter_widget_cmd.txt');
app.post('/api/cloud/logout-and-restart', (req, res) => {
  currentUser = null;
  currentDevice = null;
  currentPlan = null;
  clearSession();
  try {
    fs.writeFileSync(WIDGET_CMD_FILE, 'LogoutAndRestart', 'utf8');
  } catch (e) {
    console.warn('[cloud] write LogoutAndRestart cmd failed:', e.message);
  }
  res.json({ ok: true });
});

// Cloud me：返回当前进程记住的用户信息与 plan
app.get('/api/cloud/me', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  if (!currentUser) {
    return res.status(401).json({ error: 'not_logged_in' });
  }
  try {
    let planRow = null;
    try {
      planRow = await ensureUserPlan(currentUser.id);
    } catch (planErr) {
      console.warn('[cloud] ensureUserPlan in /me failed:', planErr);
    }
    res.json({
      ok: true,
      user: currentUser,
      plan: mapPlanRow(planRow),
      device: currentDevice
        ? {
            id: currentDevice.id,
            deviceKey: currentDevice.deviceKey,
            displayName: currentDevice.displayName,
            isCurrentDevice: true
          }
        : null
    });
  } catch (e) {
    res.status(500).json({ error: 'me_failed', message: e.message });
  }
});

// Cloud devices：列出当前用户的所有设备
app.get('/api/cloud/devices', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  if (!currentUser) {
    return res.status(401).json({ error: 'not_logged_in' });
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('devices')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: true });
    if (error) {
      return res.status(500).json({ error: 'devices_fetch_failed', message: error.message });
    }
    const devices = (data || []).map((d) => ({
      id: d.id,
      deviceKey: d.device_key,
      displayName: d.display_name,
      lastSeenAt: d.last_seen_at,
      disabled: !!d.disabled_at,
      isCurrentDevice: d.device_key === LOCAL_DEVICE_KEY
    }));
    res.json({ ok: true, devices });
  } catch (e) {
    res.status(500).json({ error: 'devices_failed', message: e.message });
  }
});

// Cloud devices rename：修改设备别名
app.post('/api/cloud/devices/rename', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  if (!currentUser) {
    return res.status(401).json({ error: 'not_logged_in' });
  }
  const { deviceId, displayName } = req.body || {};
  if (!deviceId || !displayName || typeof displayName !== 'string') {
    return res.status(400).json({ error: 'deviceId_and_displayName_required' });
  }
  try {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      return res.status(400).json({ error: 'displayName_empty' });
    }
    const { data, error } = await supabaseAdmin
      .from('devices')
      .update({ display_name: trimmedName })
      .eq('id', deviceId)
      .eq('user_id', currentUser.id)
      .select('*')
      .single();
    if (error) {
      return res.status(500).json({ error: 'rename_failed', message: error.message });
    }
    if (currentDevice && currentDevice.id === deviceId) {
      currentDevice.displayName = trimmedName;
    }
    res.json({
      ok: true,
      device: {
        id: data.id,
        deviceKey: data.device_key,
        displayName: data.display_name,
        lastSeenAt: data.last_seen_at,
        disabled: !!data.disabled_at,
        isCurrentDevice: data.device_key === LOCAL_DEVICE_KEY
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'devices_rename_failed', message: e.message });
  }
});

// Cloud data: 多设备视图（view=all 聚合所有设备，view=device 指定设备）
app.get('/api/cloud/data', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  if (!currentUser) {
    return res.status(401).json({ error: 'not_logged_in' });
  }
  const view = req.query.view || 'all';
  const deviceId = req.query.deviceId || null;

  try {
    // 统一从 daily_rollups 读取，保证多设备数据一致可加总（所有设备 = 各设备之和）
    let query = supabaseAdmin
      .from('daily_rollups')
      .select('day_id, device_id, keys_total, mouse_left_total, mouse_right_total, wheel_up_total, wheel_down_total, per_key_total')
      .eq('user_id', currentUser.id);

    if (view === 'device' && deviceId) {
      query = query.eq('device_id', deviceId);
    }

    const { data: rows, error } = await query;
    if (error) {
      return res.status(500).json({ error: 'query_failed', message: error.message });
    }

    const dayData = {};
    const dayIdsSet = new Set();

    if (view === 'all' && rows && rows.length > 0) {
      const byDay = {};
      for (const r of rows) {
        const dayId = r.day_id;
        dayIdsSet.add(dayId);
        if (!byDay[dayId]) {
          byDay[dayId] = {
            keyboard: 0,
            mouseLeft: 0,
            mouseRight: 0,
            wheelUp: 0,
            wheelDown: 0,
            perKey: {}
          };
        }
        byDay[dayId].keyboard += toInt(r.keys_total);
        byDay[dayId].mouseLeft += toInt(r.mouse_left_total);
        byDay[dayId].mouseRight += toInt(r.mouse_right_total);
        byDay[dayId].wheelUp += toInt(r.wheel_up_total);
        byDay[dayId].wheelDown += toInt(r.wheel_down_total);
        const pk = r.per_key_total || {};
        for (const [k, v] of Object.entries(pk)) {
          byDay[dayId].perKey[k] = (byDay[dayId].perKey[k] || 0) + toInt(v);
        }
      }
      for (const [dayId, agg] of Object.entries(byDay)) {
        dayData[dayId] = {
          totals: {
            keyboard: agg.keyboard,
            mouseLeft: agg.mouseLeft,
            mouseRight: agg.mouseRight,
            wheelUp: agg.wheelUp,
            wheelDown: agg.wheelDown
          },
          perKey: agg.perKey
        };
      }
    } else if (view === 'device' && rows) {
      for (const r of rows) {
        const dayId = r.day_id;
        dayIdsSet.add(dayId);
        const pk = r.per_key_total || {};
        const perKey = {};
        for (const [k, v] of Object.entries(pk)) perKey[k] = toInt(v);
        dayData[dayId] = {
          totals: {
            keyboard: toInt(r.keys_total),
            mouseLeft: toInt(r.mouse_left_total),
            mouseRight: toInt(r.mouse_right_total),
            wheelUp: toInt(r.wheel_up_total),
            wheelDown: toInt(r.wheel_down_total)
          },
          perKey
        };
      }
    }

    const days = [...dayIdsSet].sort();
    const totals = { keyboard: 0, mouseLeft: 0, mouseRight: 0, wheelUp: 0, wheelDown: 0 };
    for (const d of Object.values(dayData)) {
      const t = d.totals || {};
      totals.keyboard += t.keyboard || 0;
      totals.mouseLeft += t.mouseLeft || 0;
      totals.mouseRight += t.mouseRight || 0;
      totals.wheelUp += t.wheelUp || 0;
      totals.wheelDown += t.wheelDown || 0;
    }

    const local = getDashboardData();
    res.json({
      currentDayId: local.currentDayId,
      totals,
      days,
      dayData,
      guiIni: local.guiIni || {},
      viewInfo: { view, deviceId: deviceId || null, isCurrentDevice: !!currentDevice && currentDevice.id === deviceId }
    });
  } catch (e) {
    console.error('[cloud] /api/cloud/data error', e);
    res.status(500).json({ error: 'data_failed', message: e.message });
  }
});

// Cloud sync: 上传 data 文件夹内所有日期的数据到 daily_rollups
app.post('/api/cloud/sync/uploadToday', async (req, res) => {
  if (!supabase || !supabaseAdmin) {
    return res.status(500).json({ error: 'cloud_not_configured' });
  }
  if (!currentUser || !currentDevice) {
    return res.status(401).json({ error: 'not_logged_in' });
  }
  if (currentPlan && currentPlan.plan !== 'pro') {
    return res.status(403).json({ error: 'pro_required' });
  }
  try {
    const local = getDashboardData();
    const dayIds = listDayIds();
    // 若当日有数据但尚未写入 data 文件，从 cache 补充
    const allDayIds = new Set(dayIds);
    if (local.currentDayId && !allDayIds.has(local.currentDayId)) {
      allDayIds.add(local.currentDayId);
    }

    const uploaded = { keys: 0, mouseLeft: 0, mouseRight: 0, wheelUp: 0, wheelDown: 0, perKeyCount: 0, daysCount: 0 };
    const errors = [];

    for (const dayId of [...allDayIds].sort()) {
      let day = readDay(dayId);
      if (!day && local.dayData && local.dayData[dayId]) {
        const cached = local.dayData[dayId];
        day = { dayId, totals: cached.totals || {}, perKey: cached.perKey || {} };
      }
      if (!day) continue;

      const totals = day.totals || {};
      const perKey = day.perKey || {};
      const payload = {
        user_id: currentUser.id,
        device_id: currentDevice.id,
        day_id: dayId,
        keys_total: toInt(totals.keyboard),
        mouse_left_total: toInt(totals.mouseLeft),
        mouse_right_total: toInt(totals.mouseRight),
        wheel_up_total: toInt(totals.wheelUp),
        wheel_down_total: toInt(totals.wheelDown),
        per_key_total: perKey,
        updated_at: new Date().toISOString()
      };

      const { error } = await supabaseAdmin
        .from('daily_rollups')
        .upsert(payload, { onConflict: 'user_id,device_id,day_id' });

      if (error) {
        errors.push({ dayId, message: error.message });
        continue;
      }

      uploaded.keys += toInt(totals.keyboard);
      uploaded.mouseLeft += toInt(totals.mouseLeft);
      uploaded.mouseRight += toInt(totals.mouseRight);
      uploaded.wheelUp += toInt(totals.wheelUp);
      uploaded.wheelDown += toInt(totals.wheelDown);
      uploaded.perKeyCount += Object.keys(perKey).length;
      uploaded.daysCount += 1;
    }

    await supabaseAdmin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', currentDevice.id)
      .eq('user_id', currentUser.id);

    res.json({
      ok: true,
      uploaded,
      errors: errors.length ? errors : undefined
    });
  } catch (e) {
    console.error('[cloud] uploadToday failed', e);
    res.status(500).json({ error: 'upload_today_failed', message: e.message });
  }
});

// ------- 本地统计数据相关路由 -------
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

