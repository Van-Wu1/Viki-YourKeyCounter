/**
 * KeyCounter Dashboard - Chromium 渲染，支持现代 JS
 */

(function () {
  let currentRange = 'day';
  let trendChartRange = 'week';
  let activityMode = 'all';
  let keyChartInstance = null;
  let mouseChartInstance = null;
  let trendChartInstance = null;
  let cloudState = {
    user: null,
    plan: null,
    devices: [],
    localDeviceKey: null
  };

  function getData() {
    return window.__KEYCOUNTER_DATA__ || {};
  }

  function setCloudState(partial) {
    cloudState = { ...cloudState, ...partial };
  }

  async function loadData() {
    try {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      window.__KEYCOUNTER_DATA__ = {
        currentDayId: json.currentDayId,
        totals: json.totals || {},
        days: json.days || [],
        dayData: json.dayData || {}
      };
      window.__KEYCOUNTER_GUI_INI__ = json.guiIni || { Floating: {}, Preferences: {} };
      return true;
    } catch (e) {
      console.error('loadData failed:', e);
      window.__KEYCOUNTER_DATA__ = { currentDayId: '', totals: {}, days: [], dayData: {} };
      window.__KEYCOUNTER_GUI_INI__ = { Floating: {}, Preferences: {} };
      return false;
    }
  }

  function showLoginOverlay(show, hint) {
    const overlay = document.getElementById('loginOverlay');
    const hintEl = document.getElementById('loginHint');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';
    if (hintEl) hintEl.textContent = hint || '';
  }

  async function cloudBootstrap() {
    try {
      await fetch('/api/cloud/bootstrap', { method: 'POST' });
    } catch (_) {}
  }

  async function ensureLoggedInOrShowGate() {
    await cloudBootstrap();
    try {
      const meRes = await fetch('/api/cloud/me');
      if (meRes.ok) {
        const me = await meRes.json();
        if (me && me.ok && me.user) {
          setCloudState({ user: me.user, plan: me.plan || null });
          showLoginOverlay(false);
          return true;
        }
      }
    } catch (_) {}
    showLoginOverlay(true, '请先登录后开始统计。');
    return false;
  }

  function initLoginGate() {
    const btn = document.getElementById('loginSubmitBtn');
    const emailEl = document.getElementById('loginEmail');
    const pwdEl = document.getElementById('loginPassword');
    const hintEl = document.getElementById('loginHint');
    if (!btn || !emailEl || !pwdEl) return;
    btn.onclick = async () => {
      const email = emailEl.value.trim();
      const password = pwdEl.value;
      if (!email || !password) {
        if (hintEl) hintEl.textContent = '请填写邮箱和密码。';
        return;
      }
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '登录中...';
      if (hintEl) hintEl.textContent = '';
      try {
        const res = await fetch('/api/cloud/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, deviceName: 'This Device' })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || res.statusText);
        setCloudState({ user: json.user || null, plan: json.plan || null });
        showLoginOverlay(false);
        // 登录后再初始化页面数据
        await initAfterLogin();
      } catch (e) {
        if (hintEl) hintEl.textContent = '登录失败：请检查邮箱或密码。';
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    };
  }

  function renderDeviceViewButtons() {
    const row = document.getElementById('deviceViewRow');
    const wrap = document.getElementById('deviceViewBtns');
    if (!row || !wrap) return;
    const plan = cloudState.plan;
    if (!plan || plan.plan !== 'pro') {
      row.style.display = 'none';
      return;
    }
    row.style.display = 'block';
    // buttons: All + current device first + rest
    const devs = [...(cloudState.devices || [])];
    devs.sort((a, b) => (b.isCurrentDevice ? 1 : 0) - (a.isCurrentDevice ? 1 : 0));
    const buttons = [{ id: 'all', label: '所有设备' }, ...devs.map((d) => ({ id: d.id, label: d.displayName || d.id }))];
    const activeId = cloudState.activeViewId || 'all';
    wrap.innerHTML = '';
    // Always render 6 slots width via CSS grid; fewer buttons just fewer items.
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'device-view-btn' + (activeId === b.id ? ' active' : '');
      el.textContent = b.label;
      el.onclick = async () => {
        setCloudState({ activeViewId: b.id });
        renderDeviceViewButtons();
        // TODO: 下一步会接云端 data 渲染（此处先占位）
      };
      wrap.appendChild(el);
    });
  }

  function formatDayId(dayId) {
    if (!dayId || dayId.length !== 8) return dayId || '-';
    return dayId.slice(0, 4) + '-' + dayId.slice(4, 6) + '-' + dayId.slice(6, 8);
  }

  function dayIdToDate(dayId) {
    if (!dayId || dayId.length !== 8) return null;
    const y = parseInt(dayId.slice(0, 4), 10);
    const m = parseInt(dayId.slice(4, 6), 10) - 1;
    const d = parseInt(dayId.slice(6, 8), 10);
    return new Date(y, m, d);
  }

  function getActivity(day, mode) {
    const t = day.totals || {};
    const keys = t.keyboard || 0;
    const mouse = (t.mouseLeft || 0) + (t.mouseRight || 0) + (t.wheelUp || 0) + (t.wheelDown || 0);
    if (mode === 'keys') return keys;
    if (mode === 'mouse') return mouse;
    return keys + mouse;
  }

  function getLevel(maxVal, val) {
    if (!val || val <= 0) return 0;
    if (!maxVal) return 1;
    const p = val / maxVal;
    if (p <= 0.25) return 1;
    if (p <= 0.5) return 2;
    if (p <= 0.75) return 3;
    return 4;
  }

  function filterByRange(days, dayData, range) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayObjs = days.map((id) => {
      const d = dayData[id] || {};
      return { dayId: id, totals: d.totals || {}, perKey: d.perKey || {} };
    });

    if (range === 'day') {
      const todayId = '' + today.getFullYear() + String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
      return dayObjs.filter((d) => d.dayId === todayId);
    }
    if (range === 'week') {
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return dayObjs.filter((d) => dayIdToDate(d.dayId) >= weekAgo);
    }
    if (range === 'month') {
      const monthAgo = new Date(today);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return dayObjs.filter((d) => dayIdToDate(d.dayId) >= monthAgo);
    }
    return dayObjs;
  }

  function aggregateForRange(filteredDays) {
    const agg = { totals: { keyboard: 0, mouseLeft: 0, mouseRight: 0, wheelUp: 0, wheelDown: 0 }, perKey: {} };
    for (const d of filteredDays) {
      const t = d.totals || {};
      agg.totals.keyboard += t.keyboard || 0;
      agg.totals.mouseLeft += t.mouseLeft || 0;
      agg.totals.mouseRight += t.mouseRight || 0;
      agg.totals.wheelUp += t.wheelUp || 0;
      agg.totals.wheelDown += t.wheelDown || 0;
      for (const [k, v] of Object.entries(d.perKey || {})) {
        agg.perKey[k] = (agg.perKey[k] || 0) + (v || 0);
      }
    }
    return agg;
  }

  function render() {
    if (!document.getElementById('activityTotal')) {
      setTimeout(render, 20);
      return;
    }
    const data = getData();
    const days = data.days || [];
    const dayData = data.dayData || {};
    const currentDayId = data.currentDayId || '';

    document.getElementById('headerDate').textContent = currentDayId
      ? '当前统计日：' + formatDayId(currentDayId)
      : '';

    renderActivityPanel(days, dayData);
    bindActivityTabs();
    bindRangeButtons();
    bindTrendButtons();
    updateVisualizations(days, dayData, currentRange);
    renderTrendChart(days, dayData, trendChartRange);
  }

  function renderActivityPanel(days, dayData) {
    const dayObjs = days.map((id) => {
      const d = dayData[id] || {};
      return { dayId: id, totals: d.totals || {}, perKey: d.perKey || {} };
    });
    const byDayId = {};
    for (const d of dayObjs) byDayId[d.dayId] = d;

    const activities = dayObjs.map((d) => getActivity(d, activityMode));
    const maxActivity = Math.max(1, ...activities);
    const totalCount = activities.reduce((a, b) => a + b, 0);

    document.getElementById('activityTotal').textContent = totalCount.toLocaleString();

    const today = new Date();
    const year = today.getFullYear();
    const WEEKS = 53;
    const jan1 = new Date(year, 0, 1);
    const firstSunday = new Date(jan1);
    firstSunday.setDate(1 - jan1.getDay());

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const monthAbbr = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    const dayLabels = ['日','一','二','三','四','五','六'];

    const monthRow = document.getElementById('activityMonthRow');
    monthRow.innerHTML = '';
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const d = new Date(firstSunday);
      d.setDate(d.getDate() + w * 7);
      const m = d.getMonth();
      const span = document.createElement('span');
      span.className = 'activity-month-cell';
      span.textContent = m !== lastMonth ? monthAbbr[m] : '';
      lastMonth = m;
      monthRow.appendChild(span);
    }

    const dayLabelsEl = document.getElementById('activityDayLabels');
    dayLabelsEl.innerHTML = dayLabels.map((l) => `<div class="activity-day-label">${l}</div>`).join('');

    const grid = document.getElementById('activityGrid');
    grid.innerHTML = '';
    grid.style.gridTemplateColumns = `repeat(${WEEKS}, 12px)`;
    grid.style.gridTemplateRows = `repeat(7, 12px)`;

    const frag = document.createDocumentFragment();
    for (let dow = 0; dow < 7; dow++) {
      for (let w = 0; w < WEEKS; w++) {
        const d = new Date(firstSunday);
        d.setDate(d.getDate() + w * 7 + dow);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const dayId = '' + y + m + day;
        const info = byDayId[dayId];
        const activity = info ? getActivity(info, activityMode) : 0;
        const level = getLevel(maxActivity, activity);
        const cell = document.createElement('div');
        cell.className = 'activity-cell';
        cell.dataset.level = level;
        cell.dataset.dayId = dayId;
        cell.dataset.activity = activity;
        cell.dataset.keys = info ? (info.totals?.keyboard || 0) : 0;
        cell.dataset.mouse = info ? ((info.totals?.mouseLeft || 0) + (info.totals?.mouseRight || 0) + (info.totals?.wheelUp || 0) + (info.totals?.wheelDown || 0)) : 0;
        frag.appendChild(cell);
      }
    }
    grid.appendChild(frag);

    const byMonth = {};
    for (const d of dayObjs) {
      const m = d.dayId.slice(0, 6);
      byMonth[m] = (byMonth[m] || 0) + getActivity(d, activityMode);
    }
    let mostActiveMonth = '-';
    let mostActiveMonthVal = 0;
    for (const [m, v] of Object.entries(byMonth)) {
      if (v > mostActiveMonthVal) {
        mostActiveMonthVal = v;
        mostActiveMonth = m.slice(0, 4) + '年' + monthNames[parseInt(m.slice(4, 6), 10) - 1];
      }
    }

    let mostActiveDay = '';
    let mostActiveDayVal = 0;
    for (const d of dayObjs) {
      const v = getActivity(d, activityMode);
      if (v > mostActiveDayVal) {
        mostActiveDayVal = v;
        mostActiveDay = formatDayId(d.dayId);
      }
    }

    document.getElementById('mostActiveMonth').textContent = mostActiveMonth || '-';
    document.getElementById('mostActiveDay').textContent = mostActiveDay || '-';

    setupActivityDrag();
    setupActivityTooltip();
  }

  function formatTooltipDate(dayId) {
    if (!dayId || dayId.length !== 8) return '-';
    const y = parseInt(dayId.slice(0, 4), 10);
    const m = parseInt(dayId.slice(4, 6), 10) - 1;
    const d = parseInt(dayId.slice(6, 8), 10);
    const date = new Date(y, m, d);
    const weekdays = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
    const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    return `${y}年${months[m]}${d}日 ${weekdays[date.getDay()]}`;
  }

  function formatTooltipValue(mode, activity, keys, mouse) {
    if (mode === 'all') return `总计 ${Number(activity).toLocaleString()}`;
    if (mode === 'keys') return `键盘 ${Number(keys).toLocaleString()}`;
    return `鼠标 ${Number(mouse).toLocaleString()}`;
  }

  function setupActivityTooltip() {
    const tooltip = document.getElementById('activityTooltip');
    const grid = document.getElementById('activityGrid');
    if (!tooltip || !grid || grid._tooltipBound) return;
    grid._tooltipBound = true;

    grid.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.activity-cell');
      if (!cell) return;
      const dayId = cell.dataset.dayId;
      const activity = cell.dataset.activity || 0;
      const keys = cell.dataset.keys || 0;
      const mouse = cell.dataset.mouse || 0;

      tooltip.querySelector('.activity-tooltip-date').textContent = formatTooltipDate(dayId);
      tooltip.querySelector('.activity-tooltip-value').textContent = formatTooltipValue(activityMode, activity, keys, mouse);

      tooltip.classList.add('visible');
      requestAnimationFrame(() => {
        const rect = cell.getBoundingClientRect();
        const ttRect = tooltip.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        let left = centerX;
        left = Math.max(ttRect.width / 2 + 8, Math.min(left, window.innerWidth - ttRect.width / 2 - 8));
        tooltip.style.left = left + 'px';
        tooltip.style.top = (rect.top - ttRect.height - 10) + 'px';
      });
    });

    grid.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget || !grid.contains(e.relatedTarget)) {
        tooltip.classList.remove('visible');
      }
    });
  }

  function setupActivityDrag() {
    const wrap = document.getElementById('activityScrollWrap');
    if (!wrap || wrap._dragBound) return;
    wrap._dragBound = true;
    let isDown = false;
    let startX;
    let scrollLeft;
    wrap.addEventListener('mousedown', (e) => {
      isDown = true;
      startX = e.pageX - wrap.offsetLeft;
      scrollLeft = wrap.scrollLeft;
    });
    wrap.addEventListener('mouseleave', () => { isDown = false; });
    wrap.addEventListener('mouseup', () => { isDown = false; });
    wrap.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      e.preventDefault();
      const x = e.pageX - wrap.offsetLeft;
      const walk = (x - startX) * 1.2;
      wrap.scrollLeft = scrollLeft - walk;
    });
  }

  function bindActivityTabs() {
    if (document.querySelector('.activity-tab')?._activityBound) return;
    document.querySelectorAll('.activity-tab').forEach((btn) => {
      btn._activityBound = true;
      btn.onclick = () => {
        document.querySelectorAll('.activity-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activityMode = btn.dataset.mode;
        const data = getData();
        renderActivityPanel(data.days || [], data.dayData || {});
      };
    });
  }

  function bindRangeButtons() {
    document.querySelectorAll('.range-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.range-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        const data = getData();
        updateVisualizations(data.days || [], data.dayData || {}, currentRange);
      };
    });
  }

  function updateVisualizations(days, dayData, range) {
    const filtered = filterByRange(days, dayData, range);
    const agg = aggregateForRange(filtered);

    renderKeyChart(agg.perKey);
    renderMouseChart(agg.totals);
  }

  function filterByTrendRange(days, dayData, trendRange) {
    const dayObjs = days.map((id) => {
      const d = dayData[id] || {};
      return { dayId: id, totals: d.totals || {}, perKey: d.perKey || {} };
    });
    const today = new Date();
    const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    if (trendRange === 'week') {
      const weekAgo = new Date(endDate);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return dayObjs.filter((d) => dayIdToDate(d.dayId) >= weekAgo);
    }
    if (trendRange === 'month') {
      const monthAgo = new Date(endDate);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return dayObjs.filter((d) => dayIdToDate(d.dayId) >= monthAgo);
    }
    if (trendRange === 'year') {
      const byMonth = {};
      const yearAgo = new Date(endDate);
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const filtered = dayObjs.filter((d) => dayIdToDate(d.dayId) >= yearAgo);
      for (const d of filtered) {
        const monthKey = d.dayId.slice(0, 6);
        if (!byMonth[monthKey]) byMonth[monthKey] = { dayId: monthKey + '01', totals: { keyboard: 0, mouseLeft: 0, mouseRight: 0, wheelUp: 0, wheelDown: 0 } };
        const t = d.totals || {};
        byMonth[monthKey].totals.keyboard += t.keyboard || 0;
        byMonth[monthKey].totals.mouseLeft += t.mouseLeft || 0;
        byMonth[monthKey].totals.mouseRight += t.mouseRight || 0;
        byMonth[monthKey].totals.wheelUp += t.wheelUp || 0;
        byMonth[monthKey].totals.wheelDown += t.wheelDown || 0;
      }
      return Object.values(byMonth).sort((a, b) => a.dayId.localeCompare(b.dayId));
    }
    return dayObjs;
  }

  function bindTrendButtons() {
    document.querySelectorAll('.trend-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.trend-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        trendChartRange = btn.dataset.trend;
        const data = getData();
        renderTrendChart(data.days || [], data.dayData || {}, trendChartRange);
      };
    });
  }

  function renderKeyChart(perKey) {
    const chartDom = document.getElementById('keyChart');
    if (!chartDom) return;

    const entries = Object.entries(perKey || {}).map(([k, v]) => [k, v]);
    entries.sort((a, b) => (b[1] || 0) - (a[1] || 0));
    const top = entries.slice(0, 20);

    if (!keyChartInstance) keyChartInstance = echarts.init(chartDom);
    if (top.length === 0) {
      keyChartInstance.setOption({ title: { text: '暂无数据', left: 'center', top: 'center' } });
      return;
    }
    keyChartInstance.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: top.map(([k]) => k), axisLabel: { interval: 0 } },
      yAxis: { type: 'value' },
      series: [{
        type: 'bar',
        data: top.map(([, v]) => v),
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#4ade80' },
            { offset: 1, color: '#22c55e' }
          ])
        }
      }]
    });
  }

  function renderMouseChart(totals) {
    const chartDom = document.getElementById('mouseChart');
    if (!chartDom) return;

    const t = totals || {};
    const ml = t.mouseLeft || 0;
    const mr = t.mouseRight || 0;
    const wu = t.wheelUp || 0;
    const wd = t.wheelDown || 0;
    const total = ml + mr + wu + wd;

    if (!mouseChartInstance) mouseChartInstance = echarts.init(chartDom);
    if (total === 0) {
      mouseChartInstance.setOption({ title: { text: '暂无数据', left: 'center', top: 'center' } });
      return;
    }
    mouseChartInstance.setOption({
      tooltip: { trigger: 'item' },
      legend: { orient: 'horizontal', bottom: 4, itemGap: 16 },
      series: [{
        type: 'pie',
        radius: ['35%', '58%'],
        center: ['50%', '32%'],
        data: [
          { value: ml, name: '左键', itemStyle: { color: '#22c55e' } },
          { value: mr, name: '右键', itemStyle: { color: '#16a34a' } },
          { value: wu, name: '滚轮↑', itemStyle: { color: '#4ade80' } },
          { value: wd, name: '滚轮↓', itemStyle: { color: '#15803d' } }
        ],
        label: { formatter: '{b}: {c}' }
      }]
    });
  }

  function formatTrendLabel(dayId, trendRange) {
    if (trendRange === 'year' && dayId.length >= 6) {
      return dayId.slice(0, 4) + '-' + dayId.slice(4, 6);
    }
    return formatDayId(dayId);
  }

  function renderTrendChart(days, dayData, trendRange) {
    const chartDom = document.getElementById('chart');
    if (!chartDom) return null;

    const filtered = filterByTrendRange(days, dayData, trendRange);

    if (!trendChartInstance) trendChartInstance = echarts.init(chartDom);
    if (filtered.length === 0) {
      trendChartInstance.setOption({ title: { text: '暂无数据', left: 'center', top: 'center' } });
      return trendChartInstance;
    }

    const x = filtered.map((d) => formatTrendLabel(d.dayId, trendRange));
    const keyboard = filtered.map((d) => (d.totals && d.totals.keyboard) || 0);
    const mouse = filtered.map((d) => {
      const t = d.totals || {};
      return (t.mouseLeft || 0) + (t.mouseRight || 0) + (t.wheelUp || 0) + (t.wheelDown || 0);
    });

    trendChartInstance.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 24, top: 24, bottom: 72 },
      legend: { data: ['键盘', '鼠标'], bottom: 4, itemGap: 20 },
      xAxis: { type: 'category', data: x },
      yAxis: { type: 'value' },
      series: [
        { name: '键盘', type: 'line', data: keyboard, smooth: true, itemStyle: { color: '#22c55e' } },
        { name: '鼠标', type: 'line', data: mouse, smooth: true, itemStyle: { color: '#4ade80' } }
      ]
    });
    return trendChartInstance;
  }

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      keyChartInstance?.resize();
      mouseChartInstance?.resize();
      trendChartInstance?.resize();
    }, 100);
  });

  function initNav() {
    const refreshBtn = document.getElementById('headerRefreshBtn');
    document.querySelectorAll('.nav-item').forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        const page = el.dataset.page;
        document.querySelectorAll('.nav-item').forEach((n) => n.classList.remove('active'));
        el.classList.add('active');
        document.getElementById('page-dashboard').style.display = page === 'dashboard' ? 'block' : 'none';
        document.getElementById('page-preferences').style.display = page === 'preferences' ? 'block' : 'none';
        document.getElementById('headerTitle').textContent = page === 'dashboard' ? 'Dashboard' : 'Preferences';
        document.getElementById('headerDate').style.visibility = page === 'dashboard' ? 'visible' : 'hidden';
        if (refreshBtn) refreshBtn.style.display = page === 'dashboard' ? 'inline-flex' : 'none';
        const exportBtn = document.getElementById('headerExportBtn');
        if (exportBtn) exportBtn.style.display = page === 'dashboard' ? 'inline-flex' : 'none';
        if (page === 'preferences') {
          loadData().then(() => initPrefsForm());
        }
      };
    });
    if (refreshBtn) {
      refreshBtn.style.display = 'inline-flex';
      refreshBtn.onclick = doRefresh;
    }
    const exportBtn = document.getElementById('headerExportBtn');
    if (exportBtn) {
      exportBtn.style.display = 'inline-flex';
      exportBtn.onclick = doExport;
    }
  }

  async function doExport() {
    try {
      const res = await fetch('/api/export');
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'keycounter-export.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('doExport failed:', e);
      alert('导出失败：请先在项目目录运行 node api/index.js 启动 API 服务。');
    }
  }

  async function doRefresh() {
    const btn = document.getElementById('headerRefreshBtn');
    if (btn) btn.classList.add('refreshing');
    const ok = await loadData();
    if (btn) btn.classList.remove('refreshing');
    if (ok) render();
    else alert('刷新失败，请确保 API 服务已启动。');
  }

  function getGuiIni() {
    return window.__KEYCOUNTER_GUI_INI__ || { Floating: {}, Preferences: {} };
  }

  function initPrefsForm() {
    const gui = getGuiIni();
    const p = gui.Preferences || {};
    let sizePercent = parseInt(p.SizePercent, 10);
    if (isNaN(sizePercent) || sizePercent < 5 || sizePercent > 100) {
      const oldW = parseInt(p.Width, 10) || 200;
      sizePercent = Math.round((oldW / 200) * 30 / 5) * 5;
      sizePercent = Math.max(5, Math.min(100, sizePercent));
    }
    const tv = parseInt(p.Transparency, 10);
    const transparency = (isNaN(tv) || tv < 0) ? 94 : tv;
    const br = parseInt(p.BorderRadius, 10);
    const borderRadius = (isNaN(br) || br < 0) ? 14 : br;
    const sittingEnabled = p.SittingEnabled !== '0';
    const sittingMinutes = parseInt(p.SittingMinutes, 10) || 60;
    const tenosynovitisEnabled = p.TenosynovitisEnabled !== '0';
    const keyboardThreshold = parseInt(p.KeyboardThreshold, 10) || 50000;
    const mouseThreshold = parseInt(p.MouseThreshold, 10) || 10000;
    const waterEnabled = p.WaterEnabled !== '0';
    const waterMinutes = parseInt(p.WaterMinutes, 10) || 45;
    const reminderCooldown = parseInt(p.ReminderCooldown, 10) || 1;
    const theme = (p.Theme || 'light').toLowerCase() === 'dark' ? 'dark' : 'light';

    const spEl = document.getElementById('prefSizePercent');
    const spVal = document.getElementById('prefSizePercentVal');
    const tEl = document.getElementById('prefTransparency');
    const bEl = document.getElementById('prefBorderRadius');
    const tVal = document.getElementById('prefTransparencyVal');
    const seEl = document.getElementById('prefSittingEnabled');
    const smEl = document.getElementById('prefSittingMinutes');
    const teEl = document.getElementById('prefTenosynovitisEnabled');
    const ktEl = document.getElementById('prefKeyboardThreshold');
    const mtEl = document.getElementById('prefMouseThreshold');
    const weEl = document.getElementById('prefWaterEnabled');
    const wmEl = document.getElementById('prefWaterMinutes');
    const rcEl = document.getElementById('prefReminderCooldown');
    if (spEl) { spEl.value = sizePercent; if (spVal) spVal.textContent = sizePercent; }
    if (tEl) { tEl.value = transparency; tVal.textContent = transparency; }
    if (bEl) bEl.value = borderRadius;
    if (seEl) seEl.checked = sittingEnabled;
    if (smEl) smEl.value = sittingMinutes;
    if (teEl) teEl.checked = tenosynovitisEnabled;
    if (ktEl) ktEl.value = keyboardThreshold;
    if (mtEl) mtEl.value = mouseThreshold;
    if (weEl) weEl.checked = waterEnabled;
    if (wmEl) wmEl.value = waterMinutes;
    if (rcEl) rcEl.value = reminderCooldown;
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    if (tEl) tEl.oninput = () => { tVal.textContent = tEl.value; };
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.onclick = () => {
        document.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });
    if (spEl && spVal) spEl.oninput = () => { spVal.textContent = spEl.value; };

    initCloudPrefs();
  }

  async function fetchCloudMeAndDevices() {
    try {
      const meRes = await fetch('/api/cloud/me');
      if (!meRes.ok) {
        if (meRes.status === 401) {
          setCloudState({ user: null, plan: null, devices: [] });
          return;
        }
        throw new Error('me ' + meRes.statusText);
      }
      const me = await meRes.json();
      if (!me.ok) {
        setCloudState({ user: null, plan: null, devices: [] });
        return;
      }
      setCloudState({ user: me.user || null, plan: me.plan || null, localDeviceKey: me.localDeviceKey || null });
      if (!me.user) {
        setCloudState({ devices: [] });
        return;
      }
      const devRes = await fetch('/api/cloud/devices');
      if (!devRes.ok) {
        if (devRes.status === 401) return;
        throw new Error('devices ' + devRes.statusText);
      }
      const devJson = await devRes.json();
      if (devJson.ok) {
        setCloudState({ devices: devJson.devices || [] });
      }
    } catch (e) {
      console.warn('fetchCloudMeAndDevices failed:', e);
    }
  }

  function renderCloudPrefs() {
    const statusEl = document.getElementById('cloudStatusText');
    const accountRow = document.getElementById('cloudAccountInfo');
    const planTextEl = document.getElementById('cloudPlanText');
    const planHintEl = document.getElementById('cloudPlanHint');
    const devicesRow = document.getElementById('cloudDevicesRow');
    const devicesList = document.getElementById('cloudDevicesList');
    const syncRow = document.getElementById('cloudSyncRow');
    const emailInput = document.getElementById('cloudEmail');
    const pwdInput = document.getElementById('cloudPassword');
    const sidebarUser = document.getElementById('sidebarUserInfo');
    if (!statusEl || !accountRow || !planTextEl || !planHintEl || !devicesRow || !devicesList) return;

    if (!cloudState.user) {
      statusEl.textContent = '未登录';
      accountRow.style.display = 'none';
      devicesRow.style.display = 'none';
      if (syncRow) syncRow.style.display = 'none';
      if (sidebarUser) sidebarUser.textContent = '';
      return;
    }

    statusEl.textContent = '已登录：' + (cloudState.user.email || '');
    accountRow.style.display = 'flex';

    const plan = cloudState.plan || { plan: 'free', deviceLimit: 1, retentionDays: 90 };
    const planLabel = plan.plan === 'pro' ? 'Pro 计划' : 'Free 计划';
    const deviceLimit = plan.deviceLimit ?? 1;
    const retentionDays = plan.retentionDays;
    planTextEl.textContent = `${planLabel} · 设备上限：${deviceLimit} 台 · 保留天数：${retentionDays ?? '不限'}`;
    if (plan.plan === 'free') {
      planHintEl.textContent = 'Free：仅支持 1 台设备，云端仅保留最近 90 天的数据。';
    } else {
      planHintEl.textContent = 'Pro：最多 5 台设备，当前不限制数据保留天数。';
    }

    devicesRow.style.display = 'flex';
    if (syncRow) syncRow.style.display = 'flex';
    devicesList.innerHTML = '';
    const devs = cloudState.devices || [];
    if (!devs.length) {
      const li = document.createElement('li');
      li.textContent = '暂无设备记录。';
      devicesList.appendChild(li);
    } else {
      devs.forEach((d) => {
        const li = document.createElement('li');
        li.className = 'prefs-cloud-device-item';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = d.displayName || '';
        nameInput.className = 'prefs-cloud-device-name';
        const metaSpan = document.createElement('span');
        metaSpan.className = 'prefs-cloud-device-meta';
        const tags = [];
        if (d.isCurrentDevice) tags.push('本机');
        if (d.disabled) tags.push('已禁用');
        if (tags.length) metaSpan.textContent = `（${tags.join(' · ')}）`;
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.textContent = '重命名';
        saveBtn.onclick = async () => {
          const newName = nameInput.value.trim();
          if (!newName) {
            alert('设备名称不能为空');
            return;
          }
          saveBtn.disabled = true;
          saveBtn.textContent = '保存中...';
          try {
            const res = await fetch('/api/cloud/devices/rename', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ deviceId: d.id, displayName: newName })
            });
            if (!res.ok) throw new Error(await res.text());
            const json = await res.json();
            if (!json.ok) throw new Error(json.error || 'rename_failed');
            await fetchCloudMeAndDevices();
            renderCloudPrefs();
          } catch (e) {
            console.error('rename device failed:', e);
            alert('重命名失败：' + (e.message || '请重试'));
          } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = '重命名';
          }
        };
        li.appendChild(nameInput);
        li.appendChild(saveBtn);
        li.appendChild(metaSpan);
        devicesList.appendChild(li);
      });
    }

    if (emailInput && !emailInput.value && cloudState.user.email) {
      emailInput.value = cloudState.user.email;
    }
    if (pwdInput) pwdInput.value = '';

    if (sidebarUser) {
      const planSuffix = plan.plan || 'free';
      sidebarUser.textContent = (cloudState.user.email || '') + ' · ' + planSuffix;
    }
  }

  function initCloudPrefs() {
    const loginBtn = document.getElementById('cloudLoginBtn');
    const emailInput = document.getElementById('cloudEmail');
    const pwdInput = document.getElementById('cloudPassword');
    const statusEl = document.getElementById('cloudStatusText');
    const uploadBtn = document.getElementById('cloudUploadTodayBtn');
    const uploadStatus = document.getElementById('cloudUploadTodayStatus');
    const logoutBtn = document.getElementById('cloudLogoutBtn');
    if (!loginBtn || !emailInput || !pwdInput || !statusEl) return;

    loginBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const password = pwdInput.value;
      if (!email || !password) {
        alert('请填写邮箱和密码');
        return;
      }
      loginBtn.disabled = true;
      loginBtn.textContent = '登录中...';
      statusEl.textContent = '';
      try {
        const res = await fetch('/api/cloud/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, deviceName: '下班快乐机' })
        });
        const json = await res.json();
        if (!res.ok || !json.ok) {
          throw new Error(json.error || res.statusText);
        }
        setCloudState({
          user: json.user || null,
          plan: json.plan || null,
          localDeviceKey: json.localDeviceKey || null
        });
        if (json.device && json.device.error === 'device_limit_exceeded') {
          alert('当前计划仅支持 1 台设备，已达到上限。如需在多台设备同步，请升级到 Pro。');
        }
        await fetchCloudMeAndDevices();
        renderCloudPrefs();
      } catch (e) {
        console.error('cloud login failed:', e);
        alert('登录失败：' + (e.message || '请检查邮箱和密码'));
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = '登录云账号';
      }
    };

    if (uploadBtn && uploadStatus) {
      uploadBtn.onclick = async () => {
        uploadBtn.disabled = true;
        const oldText = uploadBtn.textContent;
        uploadBtn.textContent = '上传中...';
        uploadStatus.textContent = '';
        try {
          const res = await fetch('/api/cloud/sync/uploadToday', { method: 'POST' });
          const json = await res.json();
          if (!res.ok || !json.ok) {
            throw new Error(json.error || res.statusText);
          }
          uploadStatus.textContent = `已上传：Keys ${json.uploaded.keys.toLocaleString()} · Mouse ${(json.uploaded.mouseLeft + json.uploaded.mouseRight + json.uploaded.wheelUp + json.uploaded.wheelDown).toLocaleString()} · PerKey ${json.uploaded.perKeyCount}`;
        } catch (e) {
          console.error('uploadToday failed:', e);
          uploadStatus.textContent = '上传失败：' + (e.message || '请重试');
        } finally {
          uploadBtn.disabled = false;
          uploadBtn.textContent = oldText;
        }
      };
    }

    if (logoutBtn) {
      logoutBtn.onclick = async () => {
        try {
          await fetch('/api/cloud/logout', { method: 'POST' });
          setCloudState({ user: null, plan: null, devices: [] });
          renderCloudPrefs();
          showLoginOverlay(true, '已退出登录，请重新登录以继续使用。');
        } catch (e) {
          console.error('logout failed:', e);
        }
      };
    }

    // 进入 Preferences 页面时尝试加载一次 cloud 状态
    fetchCloudMeAndDevices().then(() => {
      renderCloudPrefs();
    });
  }

  async function savePrefs() {
    const gui = getGuiIni();
    const f = gui.Floating || {};
    const sizePercent = parseInt(document.getElementById('prefSizePercent').value, 10) || 30;
    const tv = parseInt(document.getElementById('prefTransparency').value, 10);
    const transparency = (isNaN(tv) || tv < 0) ? 94 : tv;
    const br = parseInt(document.getElementById('prefBorderRadius').value, 10);
    const borderRadius = (isNaN(br) || br < 0) ? 14 : br;
    const sittingEnabled = document.getElementById('prefSittingEnabled').checked ? '1' : '0';
    const sittingMinutes = parseInt(document.getElementById('prefSittingMinutes').value, 10) || 60;
    const tenosynovitisEnabled = document.getElementById('prefTenosynovitisEnabled').checked ? '1' : '0';
    const keyboardThreshold = parseInt(document.getElementById('prefKeyboardThreshold').value, 10) || 0;
    const mouseThreshold = parseInt(document.getElementById('prefMouseThreshold').value, 10) || 0;
    const waterEnabled = document.getElementById('prefWaterEnabled').checked ? '1' : '0';
    const waterMinutes = parseInt(document.getElementById('prefWaterMinutes').value, 10) || 45;
    const reminderCooldown = parseInt(document.getElementById('prefReminderCooldown').value, 10) || 1;
    const theme = document.querySelector('.theme-btn.active')?.dataset.theme || 'light';

    const lines = [
      '[Floating]',
      'X=' + (f.X || '0'),
      'Y=' + (f.Y || '0'),
      'Visible=' + (f.Visible || '1'),
      '',
      '[Preferences]',
      'Theme=' + theme,
      'SizePercent=' + sizePercent,
      'Transparency=' + transparency,
      'BorderRadius=' + borderRadius,
      'SittingEnabled=' + sittingEnabled,
      'SittingMinutes=' + sittingMinutes,
      'TenosynovitisEnabled=' + tenosynovitisEnabled,
      'KeyboardThreshold=' + keyboardThreshold,
      'MouseThreshold=' + mouseThreshold,
      'WaterEnabled=' + waterEnabled,
      'WaterMinutes=' + waterMinutes,
      'ReminderCooldown=' + reminderCooldown
    ];
    const content = lines.join('\r\n');

    try {
      const res = await fetch('/api/prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      if (res.ok) {
        showToast('已保存');
        window.__KEYCOUNTER_GUI_INI__ = {
          Floating: f,
          Preferences: {
            Theme: theme, SizePercent: String(sizePercent), Transparency: String(transparency), BorderRadius: String(borderRadius),
            SittingEnabled: sittingEnabled, SittingMinutes: String(sittingMinutes),
            TenosynovitisEnabled: tenosynovitisEnabled, KeyboardThreshold: String(keyboardThreshold),
            MouseThreshold: String(mouseThreshold), WaterEnabled: waterEnabled, WaterMinutes: String(waterMinutes),
            ReminderCooldown: String(reminderCooldown)
          }
        };
      } else {
        throw new Error(res.statusText);
      }
    } catch (e) {
      console.error('savePrefs failed:', e);
      alert('保存失败：' + (e.message || '请重试。'));
    }
  }

  function showToast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
    clearTimeout(el._toastTimer);
    el._toastTimer = setTimeout(() => el.classList.remove('visible'), 1500);
  }

  document.getElementById('prefsSaveBtn').onclick = savePrefs;

  function maybeOpenPrefs() {
    if (window.location.hash === '#preferences') {
      const prefsNav = document.querySelector('.nav-item[data-page="preferences"]');
      if (prefsNav) prefsNav.click();
    }
  }

  async function init() {
    initLoginGate();
    const loggedIn = await ensureLoggedInOrShowGate();
    if (!loggedIn) return;
    await initAfterLogin();
  }

  async function initAfterLogin() {
    // 登录后再加载数据与初始化 UI
    const headerEl = document.getElementById('headerDate');
    if (headerEl) headerEl.textContent = '加载中...';
    const ok = await loadData();
    if (!ok) {
      document.getElementById('headerDate').textContent = '数据加载失败，请确保 API 服务已启动。';
    }
    render();
    initNav();
    maybeOpenPrefs();
    // 刷新 cloud 状态（devices/plan）
    await fetchCloudMeAndDevices();
    renderCloudPrefs();
    renderDeviceViewButtons();
  }

  document.addEventListener('DOMContentLoaded', () => init());
  if (document.readyState !== 'loading') {
    init();
  }
})();
