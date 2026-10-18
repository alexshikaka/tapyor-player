const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const yts = require('yt-search');
const http = require('http');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');

let mainWindow = null;
let tray = null;
let appUrl = null;

// Крошечный локальный веб-сервер — отдаёт страницу приложения по http,
// чтобы встроенный плеер YouTube работал (из file:// он не запускается).
function startServer() {
  const root = __dirname;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

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

  mainWindow.loadURL(appUrl || ('file://' + path.join(__dirname, 'index.html')));

  // Не открывать новые окна (ссылки и т.п.) — всё остаётся в программе
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

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

app.whenReady().then(async () => {
  ipcMain.handle('get-version', () => app.getVersion());

  const port = await startServer();
  appUrl = 'http://127.0.0.1:' + port + '/index.html';

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

  // Получить прямой поток видео/аудио по id ролика (для встроенного плеера)
  ipcMain.handle('yt-stream', async (event, id) => {
    try {
      const info = await ytdl.getInfo('https://www.youtube.com/watch?v=' + id);
      let muxed = info.formats.filter((f) => f.hasAudio && f.hasVideo);
      muxed.sort((a, b) => (b.height || 0) - (a.height || 0));
      let f = muxed[0];
      if (!f) {
        const audio = info.formats.filter((x) => x.hasAudio && !x.hasVideo).sort((x, y) => (y.audioBitrate || 0) - (x.audioBitrate || 0));
        f = audio[0];
      }
      if (!f) return { error: 'нет подходящего потока' };
      return { url: f.url, hasVideo: !!f.hasVideo };
    } catch (err) {
      return { error: (err && err.message) ? err.message : String(err) };
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
