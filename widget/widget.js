const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');

const HEALTH_CMD_FILE = path.join(__dirname, '..', 'keycounter_health_cmd.txt');
const LONG_PRESS_MS = 1500;

function updateUI(data) {
  const { keyboard = 0, mouse = 0 } = data || {};
  document.getElementById('keys-value').textContent = Number(keyboard).toLocaleString();
  document.getElementById('mouse-value').textContent = Number(mouse).toLocaleString();
}

ipcRenderer.on('widget-counts', (_, data) => updateUI(data));

ipcRenderer.on('widget-context-menu-shown', () => {
  document.addEventListener('mousedown', (e) => {
    if (e.button === 0) ipcRenderer.send('widget-close-context-menu');
  }, { once: true });
});

// 长按确认逻辑
function writeHealthCmd(cmd) {
  try {
    fs.writeFileSync(HEALTH_CMD_FILE, cmd, 'utf8');
  } catch (err) {
    console.error('writeHealthCmd failed:', err);
  }
}

function playEvaporate(color, fromRect) {
  const container = document.getElementById('evaporate-container');
  if (!container) return;
  container.innerHTML = '';
  const containerRect = container.getBoundingClientRect();
  const w = containerRect.width;
  const h = containerRect.height;
  const centerX = fromRect.left + fromRect.width / 2 - containerRect.left;
  const startY = fromRect.bottom - containerRect.top;

  const tintRgba = color === '#3b82f6'
    ? 'rgba(59, 130, 246, 0.18)'
    : 'rgba(34, 197, 94, 0.18)';
  const tint = document.createElement('div');
  tint.className = 'evaporate-tint';
  tint.style.background = tintRgba;
  container.appendChild(tint);
  setTimeout(() => tint.remove(), 1900);

  const particleCount = 24;
  for (let i = 0; i < particleCount; i++) {
    const p = document.createElement('div');
    p.className = 'evaporate-particle';
    const startX = centerX + (Math.random() - 0.5) * 20;
    const driftX = (Math.random() - 0.5) * w * 0.9;
    const driftY = -h * (0.5 + Math.random() * 0.6);
    p.style.left = startX + 'px';
    p.style.top = startY + 'px';
    p.style.background = color;
    p.style.setProperty('--evaporate-end', `translate(${driftX}px, ${driftY}px)`);
    p.style.animationDelay = (i * 0.03) + 's';
    p.style.animationDuration = (1.2 + Math.random() * 0.6) + 's';
    container.appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }
}

function setupLongPress() {
  const ringOverlay = document.getElementById('progress-ring-overlay');
  const ringCircle = ringOverlay?.querySelector('.progress-ring-circle');
  let longPressTimer = null;
  let currentAction = null;
  let startX = 0;
  let startY = 0;
  let moveHandler = null;

  function showRing(x, y) {
    if (!ringOverlay) return;
    ringOverlay.style.left = x + 'px';
    ringOverlay.style.top = y + 'px';
    ringOverlay.classList.add('visible');
    ringOverlay.classList.remove('animating');
    ringOverlay.offsetHeight;
    ringOverlay.classList.add('animating');
  }

  function hideRing() {
    if (!ringOverlay) return;
    ringOverlay.classList.remove('visible', 'animating');
  }

  function cancel() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (moveHandler) {
      document.removeEventListener('mousemove', moveHandler);
      moveHandler = null;
    }
    currentAction = null;
    hideRing();
  }

  function onComplete(segment, action) {
    const rect = segment.getBoundingClientRect();
    if (action === 'water') {
      playEvaporate('#3b82f6', rect);
      writeHealthCmd('WaterAck');
    } else if (action === 'sitting') {
      const isResting = segment.classList.contains('resting');
      if (isResting) {
        playEvaporate('#22c55e', rect);
        writeHealthCmd('SittingRestEnd');
      } else {
        writeHealthCmd('SittingRestStart');
      }
    }
  }

  document.querySelectorAll('.light-segment[data-action]').forEach((segment) => {
    const action = segment.dataset.action;
    if (!action) return;

    segment.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!segment.classList.contains('active')) return;

      currentAction = action;
      startX = e.clientX;
      startY = e.clientY;
      showRing(startX, startY);

      moveHandler = (ev) => {
        if (ringOverlay) {
          ringOverlay.style.left = ev.clientX + 'px';
          ringOverlay.style.top = ev.clientY + 'px';
        }
      };
      document.addEventListener('mousemove', moveHandler);

      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        onComplete(segment, action);
        cancel();
      }, LONG_PRESS_MS);
    });

    segment.addEventListener('mouseup', cancel);
    segment.addEventListener('mouseleave', cancel);
  });

  document.addEventListener('mouseup', cancel);
}

document.addEventListener('DOMContentLoaded', setupLongPress);
