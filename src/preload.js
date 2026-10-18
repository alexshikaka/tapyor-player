// Мост между окном и системной частью приложения.
// Пока пусто — сюда позже добавим доступ к плееру, поиску и настройкам.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('app', {
  version: '0.1.0'
});
