// Мост между окном и системной частью приложения.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  getVersion: () => ipcRenderer.invoke('get-version'),
  ytSearch: (query) => ipcRenderer.invoke('yt-search', query),
  ytStream: (id) => ipcRenderer.invoke('yt-stream', id)
});
