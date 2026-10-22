// Мост для окна-пипетки: отдаёт скриншот экрана и возвращает выбранный цвет
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickApi', {
  init: () => ipcRenderer.invoke('pick-init'),
  done: (color) => ipcRenderer.send('pick-done', color)
});
