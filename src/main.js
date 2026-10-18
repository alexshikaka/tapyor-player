const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme, safeStorage, clipboard } = require('electron');
const ym = require('./yandex');
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

// Окно входа в Яндекс: настоящая страница Яндекса, ловим пропуск (токен) из адреса после входа
function yandexLogin() {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480, height: 720, parent: mainWindow || undefined, modal: !!mainWindow,
      autoHideMenuBar: true, title: 'Вход в Яндекс', backgroundColor: '#ffffff',
      webPreferences: { partition: 'persist:yandex-login' }
    });
    let done = false;
    const check = (u) => {
      const m = /access_token=([^&#]+)/.exec(u || '');
      if (m && !done) {
        done = true;
        resolve({ token: decodeURIComponent(m[1]) });
        setImmediate(() => { if (!win.isDestroyed()) win.close(); });
      }
    };
    win.webContents.on('will-redirect', (e, u) => check(u));
    win.webContents.on('will-navigate', (e, u) => check(u));
    win.webContents.on('did-navigate', (e, u) => check(u));
    win.webContents.on('did-navigate-in-page', (e, u) => check(u));
    win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
    win.on('closed', () => { if (!done) resolve({ error: 'вход отменён' }); });
    win.loadURL('https://oauth.yandex.ru/authorize?response_type=token&client_id=' + ym.CLIENT_ID);
  });
}

// Вход по коду через обычный браузер (официальный способ Яндекс OAuth)
const YM_CLIENT_SECRET = '53bc75238f0c4d08a118e51fe9203300'; // публичный секрет того же клиента Яндекс Музыки
let deviceLogin = null;
async function ymDeviceStart() {
  const body = new URLSearchParams({ client_id: ym.CLIENT_ID, device_name: 'Плеер для стрима' });
  const res = await fetch('https://oauth.yandex.ru/device/code', { method: 'POST', body, signal: AbortSignal.timeout(10000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.device_code) throw new Error(j.error_description || j.error || ('HTTP ' + res.status));
  deviceLogin = { code: j.device_code, interval: Math.max(2, j.interval || 5), expiresAt: Date.now() + (j.expires_in || 600) * 1000, cancelled: false };
  return { user_code: j.user_code, verification_url: j.verification_url || 'https://oauth.yandex.ru/device', expires_in: j.expires_in || 600 };
}
async function ymDeviceWait() {
  const d = deviceLogin;
  if (!d) return { error: 'вход не начат' };
  while (!d.cancelled && Date.now() < d.expiresAt) {
    await new Promise((r) => setTimeout(r, d.interval * 1000));
    if (d.cancelled) break;
    try {
      const body = new URLSearchParams({ grant_type: 'device_code', code: d.code, client_id: ym.CLIENT_ID, client_secret: YM_CLIENT_SECRET });
      const res = await fetch('https://oauth.yandex.ru/token', { method: 'POST', body, signal: AbortSignal.timeout(10000) });
      const j = await res.json().catch(() => ({}));
      if (j.access_token) return { token: j.access_token };
      if (j.error === 'authorization_pending') continue;
      if (j.error === 'slow_down') { d.interval += 2; continue; }
      return { error: j.error_description || j.error || ('HTTP ' + res.status) };
    } catch (e) { log('Яндекс: опрос входа — ' + e.message); }
  }
  return { error: d.cancelled ? 'вход отменён' : 'время ожидания истекло, попробуй ещё раз' };
}

// Подсказки YouTube (запасной вариант, если у Яндекса пусто)
async function ytSuggest(q) {
  const res = await fetch('https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ru&oe=utf-8&q=' + encodeURIComponent(q), { signal: AbortSignal.timeout(5000) });
  const buf = Buffer.from(await res.arrayBuffer());
  let txt;
  try {
    const m = /charset=([^;]+)/i.exec(res.headers.get('content-type') || '');
    txt = new TextDecoder(m ? m[1].trim() : 'utf-8').decode(buf);
  } catch (e) { txt = buf.toString('utf8'); }
  const j = JSON.parse(txt);
  return (Array.isArray(j) && Array.isArray(j[1]) ? j[1] : []).filter((s) => typeof s === 'string').slice(0, 8);
}

function fmtDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  if (!sec) return '';
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
}

// Поиск через yt-dlp (для подгрузки следующих страниц результатов)
function ytdlpSearch(query, count) {
  return new Promise((resolve) => {
    const bin = ytdlpPath();
    if (!fs.existsSync(bin)) { resolve({ error: 'yt-dlp не найден' }); return; }
    execFile(bin, ['ytsearch' + count + ':' + query, '--flat-playlist', '--dump-single-json', '--no-warnings'],
      { timeout: 45000, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) { log('поиск (ещё): ошибка ' + (stderr || err.message)); resolve({ error: 'не удалось загрузить ещё' }); return; }
        try {
          const j = JSON.parse(stdout);
          const list = (j.entries || []).filter((x) => x && x.id).map((x) => ({
            id: x.id,
            title: x.title || '',
            author: x.channel || x.uploader || '',
            duration: fmtDur(x.duration),
            seconds: x.duration || 0,
            thumb: 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg'
          }));
          log('поиск (ещё): «' + query + '» запрошено ' + count + ', получено ' + list.length);
          resolve(list);
        } catch (e) { log('поиск (ещё): ошибка разбора ' + e.message); resolve({ error: 'ошибка разбора' }); }
      });
  });
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
  async function resolveStream(id) {
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
  }

  // Кэш ссылок (живут ~4 часа) + общий запрос, если тот же трек уже грузится
  const streamCache = new Map();
  const inflight = new Map();
  const CACHE_TTL = 4 * 60 * 60 * 1000;
  async function getStream(id) {
    const c = streamCache.get(id);
    if (c && Date.now() - c.at < CACHE_TTL) { log('кэш: ' + id); return c.value; }
    if (inflight.has(id)) return inflight.get(id);
    const p = resolveStream(id);
    inflight.set(id, p);
    try {
      const r = await p;
      if (r && (r.url || r.audioUrl)) streamCache.set(id, { at: Date.now(), value: r });
      return r;
    } finally { inflight.delete(id); }
  }
  ipcMain.handle('yt-stream', (event, id) => getStream(id));
  ipcMain.handle('yt-search-more', (event, query, count) => ytdlpSearch(query, Math.min(Math.max(count || 40, 20), 300)));

  // Настройки (запоминаются между запусками)
  const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { return {}; } };
  ipcMain.handle('get-setting', (e, key) => readSettings()[key]);
  ipcMain.handle('set-setting', (e, key, value) => {
    const s = readSettings(); s[key] = value;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); }
    return true;
  });

  // --- Яндекс Музыка ---
  ym.setLogger(log);
  const writeSettings = (s) => { try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); } };
  function getYmToken() {
    const v = readSettings().ymToken;
    if (!v) return '';
    try { return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : Buffer.from(v, 'base64').toString('utf8'); }
    catch (e) { log('Яндекс: не удалось прочитать токен ' + e.message); return ''; }
  }
  function setYmToken(tok) {
    const s = readSettings();
    if (!tok) delete s.ymToken;
    else s.ymToken = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(tok) : Buffer.from(tok, 'utf8')).toString('base64');
    writeSettings(s);
  }
  async function ymStatus() {
    const tok = getYmToken();
    if (!tok) return { loggedIn: false };
    try { const a = await ym.accountStatus(tok); return Object.assign({ loggedIn: true }, a); }
    catch (e) {
      log('Яндекс: статус аккаунта — ошибка ' + e.message);
      if (e.status === 401 || e.status === 403) { setYmToken(''); return { loggedIn: false, error: 'вход устарел, войди заново' }; }
      return { loggedIn: true, name: 'Яндекс', hasPlus: false, offline: true };
    }
  }
  ipcMain.handle('ym-status', () => ymStatus());
  ipcMain.handle('ym-login', async () => {
    const r = await yandexLogin();
    if (r.error) { log('Яндекс: ' + r.error); return r; }
    setYmToken(r.token);
    log('Яндекс: вход выполнен');
    return ymStatus();
  });
  ipcMain.handle('ym-login-browser-start', async () => {
    try {
      const d = await ymDeviceStart();
      try { clipboard.writeText(d.user_code); } catch (e) {}
      shell.openExternal(d.verification_url);
      log('Яндекс: вход через браузер — код выдан');
      return d;
    } catch (e) { log('Яндекс: вход через браузер недоступен — ' + e.message); return { error: e.message }; }
  });
  ipcMain.handle('ym-login-browser-wait', async () => {
    const r = await ymDeviceWait();
    if (r.error) { log('Яндекс: вход через браузер — ' + r.error); return r; }
    setYmToken(r.token);
    log('Яндекс: вход через браузер выполнен');
    return ymStatus();
  });
  ipcMain.handle('ym-login-browser-cancel', () => { if (deviceLogin) deviceLogin.cancelled = true; return true; });
  ipcMain.handle('open-external', (e, url) => {
    if (/^https:\/\/([a-z0-9-]+\.)*(yandex\.(ru|com|by|kz)|ya\.ru)\//i.test(String(url || ''))) shell.openExternal(url);
    return true;
  });
  ipcMain.handle('ym-logout', () => { setYmToken(''); log('Яндекс: выход'); return true; });
  ipcMain.handle('ym-search', async (e, q) => {
    try { const list = await ym.search(q, getYmToken()); log('Яндекс: поиск «' + q + '» → ' + list.length); return list; }
    catch (err) { log('Яндекс: поиск — ошибка ' + err.message); return []; }
  });
  const ymCache = new Map();
  ipcMain.handle('ym-stream', async (e, id) => {
    const tok = getYmToken();
    if (!tok) return { error: 'чтобы слушать Яндекс, войди в аккаунт (кнопка вверху)' };
    const c = ymCache.get(id);
    if (c && Date.now() - c.at < 20 * 60 * 1000) return c.value;
    try { const r = await ym.streamUrl(id, tok); ymCache.set(id, { at: Date.now(), value: r }); return r; }
    catch (err) { log('Яндекс: поток — ошибка ' + err.message); return { error: 'Яндекс: ' + err.message }; }
  });
  ipcMain.handle('suggest', async (e, part) => {
    try { const a = await ym.suggest(part, getYmToken()); if (a.length) return { source: 'ym', items: a }; }
    catch (err) { log('Яндекс: подсказки — ошибка ' + err.message); }
    try { const b = await ytSuggest(part); if (b.length) return { source: 'yt', items: b }; }
    catch (err) { log('YouTube: подсказки — ошибка ' + err.message); }
    return { source: '', items: [] };
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
