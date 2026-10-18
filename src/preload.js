// Мост между окном и системной частью приложения.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  ytSearch: (query) => ipcRenderer.invoke('yt-search', query),
  ytStream: (id) => ipcRenderer.invoke('yt-stream', id),
  ytSearchMore: (query, count) => ipcRenderer.invoke('yt-search-more', query, count),
  ymStatus: () => ipcRenderer.invoke('ym-status'),
  ymLogin: () => ipcRenderer.invoke('ym-login'),
  ymLogout: () => ipcRenderer.invoke('ym-logout'),
  ymSearch: (q) => ipcRenderer.invoke('ym-search', q),
  ymStream: (id) => ipcRenderer.invoke('ym-stream', id),
  suggest: (part) => ipcRenderer.invoke('suggest', part),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value)
});
