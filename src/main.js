const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const yts = require('yt-search');

let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0E0F13',
    title: 'Плеер для стрима',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Закрытие окна сворачивает в трей, а не выходит из программы
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Плеер для стрима');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => { if (mainWindow) mainWindow.show(); }
    },
    {
      label: 'Проверить обновления',
      click: () => checkForUpdates(true)
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => { app.isQuitting = true; app.quit(); }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { if (mainWindow) mainWindow.show(); });
}

// --- Автообновление ---
function checkForUpdates(manual) {
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-available', () => {
    if (mainWindow) mainWindow.webContents.send('update-status', 'Найдено обновление, качаю…');
  });
  autoUpdater.on('update-not-available', () => {
    if (manual) {
      dialog.showMessageBox({ message: 'У тебя уже последняя версия.', buttons: ['OK'] });
    }
  });
  autoUpdater.on('error', (err) => {
    if (manual) {
      dialog.showMessageBox({ message: 'Не удалось проверить обновления:\n' + (err && err.message ? err.message : err), buttons: ['OK'] });
    }
  });
  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox({
      type: 'info',
      message: 'Обновление загружено. Перезапустить сейчас?',
      buttons: ['Перезапустить', 'Позже']
    }).then((res) => {
      if (res.response === 0) {
        app.isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.checkForUpdates().catch(() => { /* тихо, если нет сети */ });
}

// Только один экземпляр приложения
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Запустили ещё раз — показываем уже открытое окно
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  ipcMain.handle('get-version', () => app.getVersion());

  // Поиск по YouTube (без ключа и входа)
  ipcMain.handle('yt-search', async (event, query) => {
    try {
      const r = await yts(query);
      return (r.videos || []).slice(0, 20).map((v) => ({
        id: v.videoId,
        title: v.title,
        author: (v.author && v.author.name) || '',
        duration: (v.duration && v.duration.timestamp) || '',
        seconds: (v.duration && v.duration.seconds) || 0,
        thumb: v.thumbnail
      }));
    } catch (e) {
      return { error: (e && e.message) ? e.message : String(e) };
    }
  });

  createWindow();
  createTray();

  // Проверяем обновления при запуске (тихо)
  checkForUpdates(false);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Не выходим при закрытии всех окон — живём в трее
app.on('window-all-closed', (e) => {
  // на Windows держим процесс ради трея
});
