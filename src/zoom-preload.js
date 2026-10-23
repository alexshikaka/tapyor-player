// Мост для окна масштаба: оно живёт отдельно от главного окна,
// поэтому не масштабируется и не дёргается вместе с интерфейсом.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zoomApi', {
  get: () => ipcRenderer.invoke('ui-zoom-get'),
  set: (v) => ipcRenderer.invoke('ui-zoom', v),
  close: () => ipcRenderer.send('zoom-popup-close'),
  onChange: (cb) => ipcRenderer.on('ui-zoom-changed', (_e, v) => cb(v)),
  onTheme: (cb) => ipcRenderer.on('zoom-theme', (_e, t) => cb(t)),
  theme: () => ipcRenderer.invoke('zoom-theme-get'),
  ready: () => ipcRenderer.send('zoom-ready')
});
