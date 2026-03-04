const { ipcRenderer } = require('electron');

function updateUI(data) {
  const { keyboard = 0, mouse = 0 } = data || {};
  document.getElementById('keys-value').textContent = Number(keyboard).toLocaleString();
  document.getElementById('mouse-value').textContent = Number(mouse).toLocaleString();
}

ipcRenderer.on('widget-counts', (_, data) => updateUI(data));
