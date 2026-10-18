const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme } = require('electron');
nativeTheme.themeSource = 'dark'; // тёмные системные окна и диалоги
const path = require('path');
const { autoUpdater } = require('electron-updater');
const yts = require('yt-search');
const http = require('http');
const fs = require('fs');
const ytdl = require('@distube/ytdl-core');
const { execFile } = require('child_process');

// --- Логирование (для отладки) ---
function logPath() { try { return path.join(app.getPath('userData'), 'log.txt'); } catch (e) { return path.join(__dirname, 'log.txt'); } }
function log(msg) {
  try { fs.appendFileSync(logPath(), new Date().toISOString() + '  ' + String(msg) + '\n'); } catch (e) {}
}

// Путь к yt-dlp (кладётся в ресурсы приложения при сборке)
function ytdlpPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp.exe');
  return path.join(__dirname, '..', 'resources', 'yt-dlp.exe');
}

// Достать прямую ссылку на поток через yt-dlp (надёжный способ)
function streamViaYtDlp(videoUrl) {
  return new Promise((resolve) => {
    const bin = ytdlpPath();
    const exists = fs.existsSync(bin);
    log('yt-dlp: запуск. bin=' + bin + ' | файл есть=' + exists + ' | url=' + videoUrl);
    if (!exists) { resolve({ error: 'yt-dlp.exe не найден по пути: ' + bin }); return; }
    execFile(bin, [
      // видео (до 720p) + звук раздельно; иначе единый файл; иначе только звук
      '-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b/ba',
      '-g', '--no-playlist', '--no-warnings',
      videoUrl
    ], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        log('yt-dlp: ОШИБКА code=' + (err.code) + ' msg=' + (err.message || '') + ' | stderr=' + (stderr || ''));
        resolve({ error: ('yt-dlp: ' + ((stderr || err.message || '').toString())).slice(0, 400) });
        return;
      }
      const lines = (stdout || '').trim().split(/\r?\n/).filter(Boolean);
      if (!lines.length) { log('yt-dlp: пустой вывод'); resolve({ error: 'yt-dlp: пустой ответ' }); return; }
      if (lines.length >= 2) {
        log('yt-dlp: успех, раздельные потоки (видео + звук)');
        resolve({ videoUrl: lines[0], audioUrl: lines[1] });
      } else {
        log('yt-dlp: успех, единый поток');
        resolve({ url: lines[0] });
      }
    });
  });
}

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
    // Тёмная верхняя полоса в цвет оформления; системные кнопки остаются
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0E0F13', symbolColor: '#C9CBD4', height: 36 },
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
    {
      label: 'Показать лог (для отладки)',
      click: () => { try { shell.openPath(logPath()); } catch (e) {} }
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
let manualCheck = false;
let updaterReady = false;

function initUpdater() {
  if (updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = false; // решаем сами, качать или нет

  autoUpdater.on('update-available', (info) => {
    if (manualCheck) {
      dialog.showMessageBox({
        type: 'info',
        message: 'Доступна новая версия ' + (info && info.version ? info.version : '') + '.',
        detail: 'Скачать и установить сейчас?',
        buttons: ['Скачать', 'Позже'], defaultId: 0, cancelId: 1
      }).then((r) => { if (r.response === 0) autoUpdater.downloadUpdate(); else manualCheck = false; });
    } else {
      autoUpdater.downloadUpdate(); // при запуске качаем тихо
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) { manualCheck = false; dialog.showMessageBox({ message: 'У тебя уже последняя версия.', buttons: ['OK'] }); }
  });

  autoUpdater.on('error', (err) => {
    if (manualCheck) { manualCheck = false; dialog.showMessageBox({ message: 'Не удалось проверить обновления:\n' + (err && err.message ? err.message : err), buttons: ['OK'] }); }
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualCheck = false;
    dialog.showMessageBox({
      type: 'info',
      message: 'Обновление ' + (info && info.version ? info.version : '') + ' загружено.',
      detail: 'Перезапустить сейчас?',
      buttons: ['Перезапустить', 'Позже'], defaultId: 0, cancelId: 1
    }).then((res) => { if (res.response === 0) { app.isQuitting = true; autoUpdater.quitAndInstall(); } });
  });
}

function checkForUpdates(manual) {
  manualCheck = !!manual;
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
    const videoUrl = 'https://www.youtube.com/watch?v=' + id;
    // 1) основной способ — yt-dlp
    const viaDlp = await streamViaYtDlp(videoUrl);
    if (viaDlp && (viaDlp.url || viaDlp.audioUrl)) return viaDlp;
    // 2) запасной — ytdl-core
    try {
      const info = await ytdl.getInfo(videoUrl);
      let muxed = info.formats.filter((f) => f.hasAudio && f.hasVideo);
      muxed.sort((a, b) => (b.height || 0) - (a.height || 0));
      let f = muxed[0];
      if (!f) {
        const audio = info.formats.filter((x) => x.hasAudio && !x.hasVideo).sort((x, y) => (y.audioBitrate || 0) - (x.audioBitrate || 0));
        f = audio[0];
      }
      if (f) { log('ytdl-core: успех (запасной способ)'); return { url: f.url, hasVideo: !!f.hasVideo }; }
    } catch (err) { log('ytdl-core: ошибка ' + (err && err.message)); }
    return { error: (viaDlp && viaDlp.error) ? viaDlp.error : 'не удалось получить поток' };
  });

  // Настройки (запоминаются между запусками)
  const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { return {}; } };
  ipcMain.handle('get-setting', (e, key) => readSettings()[key]);
  ipcMain.handle('set-setting', (e, key, value) => {
    const s = readSettings(); s[key] = value;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); }
    return true;
  });

  ipcMain.handle('get-log', () => { try { return fs.readFileSync(logPath(), 'utf8').slice(-6000); } catch (e) { return 'лог пуст'; } });
  log('=== приложение запущено, версия ' + app.getVersion() + ' ===');

  createWindow();
  createTray();

  // Проверяем обновления при запуске (тихо)
  initUpdater();
  checkForUpdates(false);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Не выходим при закрытии всех окон — живём в трее
app.on('window-all-closed', (e) => {
  // на Windows держим процесс ради трея
});
