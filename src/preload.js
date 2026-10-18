// Мост между окном и системной частью приложения.
// Пока минимально — отдаём настоящую версию приложения.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('app', {
  getVersion: () => ipcRenderer.invoke('get-version')
});
