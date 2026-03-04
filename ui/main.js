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

  function getData() {
    return window.__KEYCOUNTER_DATA__ || {};
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
    const WEEKS = 53;
    const startDate = new Date(today.getFullYear(), 0, 1);

    const monthNames = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    const monthAbbr = ['1','2','3','4','5','6','7','8','9','10','11','12'];
    const dayLabels = ['日','一','二','三','四','五','六'];

    const monthRow = document.getElementById('activityMonthRow');
    monthRow.innerHTML = '';
    let lastMonth = -1;
    for (let w = 0; w < WEEKS; w++) {
      const d = new Date(startDate);
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

    for (let dow = 0; dow < 7; dow++) {
      for (let w = 0; w < WEEKS; w++) {
        const d = new Date(startDate);
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
        grid.appendChild(cell);
      }
    }

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

  window.addEventListener('resize', () => {
    keyChartInstance?.resize();
    mouseChartInstance?.resize();
    trendChartInstance?.resize();
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
        if (page === 'preferences') initPrefsForm();
      };
    });
    if (refreshBtn) {
      refreshBtn.style.display = 'inline-flex';
      refreshBtn.onclick = doRefresh;
    }
  }

  function doRefresh() {
    const btn = document.getElementById('headerRefreshBtn');
    if (btn) btn.classList.add('refreshing');
    const script = document.createElement('script');
    script.src = 'data.js?t=' + Date.now();
    script.onload = function () {
      render();
      script.remove();
      if (btn) btn.classList.remove('refreshing');
    };
    script.onerror = function () {
      location.reload(true);
      if (btn) btn.classList.remove('refreshing');
    };
    document.body.appendChild(script);
  }

  function getGuiIni() {
    return window.__KEYCOUNTER_GUI_INI__ || { Floating: {}, Preferences: {} };
  }

  function initPrefsForm() {
    const gui = getGuiIni();
    const p = gui.Preferences || {};
    const width = parseInt(p.Width, 10) || 160;
    const height = parseInt(p.Height, 10) || 70;
    const transparency = parseInt(p.Transparency, 10) || 94;
    const borderRadius = parseInt(p.BorderRadius, 10) || 14;

    const wEl = document.getElementById('prefWidth');
    const hEl = document.getElementById('prefHeight');
    const tEl = document.getElementById('prefTransparency');
    const bEl = document.getElementById('prefBorderRadius');
    const tVal = document.getElementById('prefTransparencyVal');
    if (wEl) wEl.value = width;
    if (hEl) hEl.value = height;
    if (tEl) { tEl.value = transparency; tVal.textContent = transparency; }
    if (bEl) bEl.value = borderRadius;

    if (tEl) tEl.oninput = () => { tVal.textContent = tEl.value; };
  }

  function savePrefs() {
    const gui = getGuiIni();
    const f = gui.Floating || {};
    const width = parseInt(document.getElementById('prefWidth').value, 10) || 160;
    const height = parseInt(document.getElementById('prefHeight').value, 10) || 70;
    const transparency = parseInt(document.getElementById('prefTransparency').value, 10) || 94;
    const borderRadius = parseInt(document.getElementById('prefBorderRadius').value, 10) || 14;

    const lines = [
      '[Floating]',
      'X=' + (f.X || '0'),
      'Y=' + (f.Y || '0'),
      'Visible=' + (f.Visible || '1'),
      '',
      '[Preferences]',
      'Width=' + width,
      'Height=' + height,
      'Transparency=' + transparency,
      'BorderRadius=' + borderRadius
    ];
    const content = lines.join('\r\n');

    if (typeof window.showSaveFilePicker === 'function') {
      window.showSaveFilePicker({ suggestedName: 'gui.ini', types: [{ description: 'INI', accept: { 'text/plain': ['.ini'] } }] })
        .then((h) => h.createWritable().then((w) => { w.write(content); w.close(); alert('已保存，请将 gui.ini 放到 KeyCounter 项目目录下替换原文件。'); }))
        .catch(() => fallbackDownload(content));
    } else {
      fallbackDownload(content);
    }
  }

  function fallbackDownload(content) {
    const a = document.createElement('a');
    a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
    a.download = 'gui.ini';
    a.click();
    alert('已下载 gui.ini，请将其放到 KeyCounter 项目目录下替换原文件。');
  }

  document.getElementById('prefsSaveBtn').onclick = savePrefs;

  function maybeOpenPrefs() {
    if (window.location.hash === '#preferences') {
      const prefsNav = document.querySelector('.nav-item[data-page="preferences"]');
      if (prefsNav) prefsNav.click();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    render();
    initNav();
    maybeOpenPrefs();
  });
  if (document.readyState !== 'loading') {
    render();
    initNav();
    maybeOpenPrefs();
  }
})();
