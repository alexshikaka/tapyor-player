const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme, safeStorage, clipboard } = require('electron');
const ym = require('./yandex');
nativeTheme.themeSource = 'dark'; // тёмные системные окна и диалоги
const path = require('path');
const { autoUpdater } = require('electron-updater');
const yts = require('yt-search');
const http = require('http');
const fs = require('fs');

// Папка данных программы (вход в Яндекс, настройки, лог) не должна меняться при переименовании.
// Берём ту, что уже есть от прошлых версий; для новой установки — «Тапёр».
(function pinUserData() {
  try {
    const base = app.getPath('appData');
    for (const n of ['Плеер для стрима', 'stream-player']) {
      const p = path.join(base, n);
      if (fs.existsSync(p)) { app.setPath('userData', p); return; }
    }
    app.setPath('userData', path.join(base, 'Тапёр'));
  } catch (e) { /* оставим путь по умолчанию */ }
})();
const ytdl = require('@distube/ytdl-core');
const { execFile } = require('child_process');

// --- Логирование (для отладки) ---
function logPath() { try { return path.join(app.getPath('userData'), 'log.txt'); } catch (e) { return path.join(__dirname, 'log.txt'); } }
function log(msg) {
  try { fs.appendFileSync(logPath(), new Date().toISOString() + '  ' + String(msg) + '\n'); } catch (e) {}
}

// --- Настройки и файл «сейчас играет» для OBS ---
function settingsFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettingsFile() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch (e) { return {}; } }
const DEFAULTS = {
  npEnabled: true, nowPlayingFormat: '{artist} — {title}', npIdle: '',
  videoQuality: '720', startVolume: 80, prefetch: true,
  autoUpdate: true, autoStart: false, closeToTray: true
};
function cfg(key) { const s = readSettingsFile(); return s[key] !== undefined ? s[key] : DEFAULTS[key]; }
function npFilePath() {
  const s = readSettingsFile();
  return s.nowPlayingPath || path.join(app.getPath('documents'), 'Тапёр', 'now_playing.txt');
}
function formatNowPlaying(info, fmt) {
  if (!info || !info.title) return '';
  return String(fmt || '{artist} — {title}')
    .replace(/\{artist\}/g, info.artist || '')
    .replace(/\{title\}/g, info.title || '')
    .replace(/\{album\}/g, info.album || '')
    .replace(/\{source\}/g, info.source || '')
    .replace(/^[\s—–-]+|[\s—–-]+$/g, '') // если исполнителя нет — без висящего тире
    .trim();
}
let lastNpText = null;
let lastNpInfo = null;
function writeNowPlaying(info, force) {
  let text = '';
  if (cfg('npEnabled')) {
    text = formatNowPlaying(info, cfg('nowPlayingFormat'));
    if (!text) text = String(cfg('npIdle') || ''); // ничего не играет — текст «на паузе» (или пусто)
  }
  if (text === lastNpText && !force) return;
  const p = npFilePath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, text, 'utf8');
    try { fs.renameSync(tmp, p); } // целиком за раз — OBS не прочитает полфайла
    catch (e) { fs.writeFileSync(p, text, 'utf8'); try { fs.unlinkSync(tmp); } catch (e2) {} }
    lastNpText = text;
  } catch (e) { log('now_playing.txt: ошибка записи ' + e.message); }
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
  const body = new URLSearchParams({ client_id: ym.CLIENT_ID, device_name: 'Тапёр' });
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

// Содержимое плейлиста YouTube (yt-dlp, без загрузки видео)
function ytdlpPlaylist(listId) {
  return new Promise((resolve) => {
    const bin = ytdlpPath();
    if (!fs.existsSync(bin)) { resolve({ error: 'yt-dlp не найден' }); return; }
    execFile(bin, ['https://www.youtube.com/playlist?list=' + listId, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '500'],
      { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) { log('плейлист YouTube: ошибка ' + (stderr || err.message)); resolve({ error: 'не удалось открыть плейлист' }); return; }
        try {
          const j = JSON.parse(stdout);
          const tracks = (j.entries || []).filter((x) => x && x.id && x.title && !/^\[(deleted|private)/i.test(x.title)).map((x) => ({
            src: 'yt', id: x.id, title: x.title || '', author: x.channel || x.uploader || '',
            duration: fmtDur(x.duration), seconds: x.duration || 0,
            thumb: 'https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg'
          }));
          resolve({ src: 'yt', type: 'playlist', listId: listId, title: j.title || 'Плейлист YouTube', author: j.channel || j.uploader || '', count: tracks.length, thumb: tracks[0] ? tracks[0].thumb : '', tracks: tracks });
        } catch (e) { resolve({ error: 'ошибка разбора плейлиста' }); }
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
    const q = String(cfg('videoQuality'));
    const fmt = q === 'audio' ? 'ba[ext=m4a]/ba/b'
      : q === '480' ? 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/b/ba'
      : 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b/ba';
    execFile(bin, [
      // видео + звук раздельно; иначе единый файл; иначе только звук
      '-f', fmt,
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
      } else if (q === 'audio') {
        log('yt-dlp: успех, только звук');
        resolve({ audioUrl: lines[0] });
      } else {
        log('yt-dlp: успех, единый поток');
        resolve({ url: lines[0] });
      }
    });
  });
}

let mainWindow = null;
let tray = null;
const startHidden = process.argv.includes('--hidden'); // запуск вместе с Windows — сразу в трей
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
    title: 'Тапёр',
    show: !startHidden,
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
    if (!app.isQuitting && cfg('closeToTray')) {
      e.preventDefault();
      mainWindow.hide();
    } else if (!app.isQuitting) {
      app.isQuitting = true; // крестик = выход (так выбрано в настройках)
      app.quit();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Тапёр');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Открыть',
      click: () => { if (mainWindow) mainWindow.show(); }
    },
    {
      label: 'Проверить обновления',
      click: () => checkForUpdates(true) // откроет плеер, статус — в шапке
    },
    {
      label: 'Открыть папку now_playing.txt (для OBS)',
      click: () => {
        try {
          const p = npFilePath();
          if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '', 'utf8'); }
          shell.showItemInFolder(p);
        } catch (e) { log('now_playing.txt: не открыть папку ' + e.message); }
      }
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

// --- Автообновление (всё показывается в шапке программы, без всплывающих окон) ---
let manualCheck = false;
let updaterReady = false;
let playerBusy = false;      // играет ли сейчас музыка (сообщает окно)
let installRequested = false; // пользователь сам нажал «Обновить» — ставим сразу
let updateState = { state: 'idle' };

function sendUpdateState(st) {
  updateState = st;
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-state', st); } catch (e) {}
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function initUpdater() {
  if (updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = false;       // качаем только по кнопке «Обновить»
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => sendUpdateState({ state: 'checking', manual: manualCheck }));
  autoUpdater.on('update-available', (info) => {
    log('обновление: доступна ' + (info && info.version));
    sendUpdateState({ state: 'available', version: info && info.version, manual: manualCheck, auto: !!cfg('autoUpdate') });
    manualCheck = false;
    if (cfg('autoUpdate')) autoUpdater.downloadUpdate().catch((e) => log('обновление: автозагрузка — ' + (e && e.message)));
  });
  autoUpdater.on('update-not-available', () => {
    sendUpdateState({ state: 'latest', manual: manualCheck });
    manualCheck = false;
  });
  autoUpdater.on('error', (err) => {
    log('обновление: ошибка ' + (err && err.message));
    sendUpdateState({ state: 'error', message: (err && err.message) ? String(err.message).slice(0, 300) : String(err), manual: manualCheck });
    manualCheck = false;
  });
  autoUpdater.on('download-progress', (p) => {
    sendUpdateState({ state: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total, bps: p.bytesPerSecond });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const v = info && info.version;
    const install = () => {
      log('обновление: тихая установка ' + v + ' и перезапуск');
      sendUpdateState({ state: 'installing', version: v });
      // Тихая установка без «Далее-Далее» и автоматический перезапуск программы
      setTimeout(() => { app.isQuitting = true; autoUpdater.quitAndInstall(true, true); }, 1500);
    };
    if (installRequested || !playerBusy) { install(); return; }
    // Музыка играет — ждём паузы, посреди трека не перезапускаемся
    log('обновление: скачано ' + v + ', жду, когда музыка остановится');
    sendUpdateState({ state: 'ready', version: v });
    const t = setInterval(() => { if (!playerBusy || installRequested) { clearInterval(t); install(); } }, 3000);
  });
}

function checkForUpdates(manual) {
  manualCheck = !!manual;
  if (manual) showMainWindow();
  autoUpdater.checkForUpdates().catch((e) => { /* без сети — состояние придёт через событие error */ });
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
      const videos = (r.videos || []).slice(0, 20).map((v) => ({
        id: v.videoId,
        title: v.title,
        author: (v.author && v.author.name) || '',
        duration: (v.duration && v.duration.timestamp) || '',
        seconds: (v.duration && v.duration.seconds) || 0,
        thumb: v.thumbnail
      }));
      const playlists = (r.playlists || r.lists || []).slice(0, 6).map((p) => ({
        src: 'yt', type: 'playlist', listId: p.listId, title: p.title || '',
        author: (p.author && p.author.name) || '', count: p.videoCount || 0, thumb: p.thumbnail || p.image || ''
      })).filter((p) => p.listId);
      return { videos, playlists };
    } catch (e) {
      return { error: (e && e.message) ? e.message : String(e) };
    }
  });
  ipcMain.handle('yt-playlist', async (e, listId) => {
    const r = await ytdlpPlaylist(listId);
    if (!r.error) return r;
    try { // запасной способ
      const p = await yts({ listId: listId });
      const tracks = (p.videos || []).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail || ('https://i.ytimg.com/vi/' + v.videoId + '/mqdefault.jpg') }));
      return { src: 'yt', type: 'playlist', listId, title: p.title || 'Плейлист YouTube', author: (p.author && p.author.name) || '', count: tracks.length, thumb: p.thumbnail || p.image || '', tracks };
    } catch (err) { log('плейлист YouTube (запасной): ' + err.message); return r; }
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
  async function getStream(rawId) {
    const id = rawId;
    const key = id + '@' + cfg('videoQuality');
    const c = streamCache.get(key);
    if (c && Date.now() - c.at < CACHE_TTL) { log('кэш: ' + id); return c.value; }
    if (inflight.has(key)) return inflight.get(key);
    const p = resolveStream(id);
    inflight.set(key, p);
    try {
      const r = await p;
      if (r && (r.url || r.audioUrl)) streamCache.set(key, { at: Date.now(), value: r });
      return r;
    } finally { inflight.delete(key); }
  }
  ipcMain.handle('yt-stream', (event, id) => getStream(id));
  ipcMain.handle('yt-search-more', (event, query, count) => ytdlpSearch(query, Math.min(Math.max(count || 40, 20), 300)));

  // Настройки (запоминаются между запусками)
  const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { return {}; } };
  ipcMain.handle('get-setting', (e, key) => { const v = readSettings()[key]; return v !== undefined ? v : DEFAULTS[key]; });
  ipcMain.handle('set-setting', (e, key, value) => {
    const s = readSettings(); s[key] = value;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); }
    if (key === 'autoStart') applyAutoStart();
    if (key === 'npEnabled' || key === 'nowPlayingFormat' || key === 'npIdle' || key === 'nowPlayingPath') writeNowPlaying(lastNpInfo, true);
    return true;
  });
  function applyAutoStart() {
    try { if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!cfg('autoStart'), args: ['--hidden'] }); }
    catch (err) { log('автозапуск: ' + err.message); }
  }
  applyAutoStart();
  ipcMain.handle('np-choose-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Папка для now_playing.txt', properties: ['openDirectory', 'createDirectory'], defaultPath: path.dirname(npFilePath()) });
    if (r.canceled || !r.filePaths || !r.filePaths[0]) return null;
    const p = path.join(r.filePaths[0], 'now_playing.txt');
    const s = readSettings(); s.nowPlayingPath = p; writeSettings(s);
    writeNowPlaying(lastNpInfo, true);
    return p;
  });
  ipcMain.handle('np-open-folder', () => {
    try {
      const p = npFilePath();
      if (!fs.existsSync(p)) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '', 'utf8'); }
      shell.showItemInFolder(p);
    } catch (err) { log('now_playing.txt: не открыть папку ' + err.message); }
    return true;
  });
  ipcMain.handle('log-copy', () => { try { clipboard.writeText(fs.readFileSync(logPath(), 'utf8').slice(-20000)); return true; } catch (err) { return false; } });
  ipcMain.handle('log-open', () => { try { shell.openPath(logPath()); } catch (err) {} return true; });

  // --- Яндекс Музыка ---
  ym.setLogger(log);
  let ymUid = '';
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
  ipcMain.handle('ym-logout', () => { setYmToken(''); ymUid = ''; log('Яндекс: выход'); return true; });
  ipcMain.handle('ym-search', async (e, q) => {
    try { const r = await ym.search(q, getYmToken()); log('Яндекс: поиск «' + q + '» → треков ' + r.tracks.length + ', плейлистов ' + r.playlists.length); return r; }
    catch (err) { log('Яндекс: поиск — ошибка ' + err.message); return { tracks: [], playlists: [], artists: [] }; }
  });
  ipcMain.handle('ym-search-page', async (e, q, page) => {
    try { return await ym.searchTracksPage(q, page, getYmToken()); }
    catch (err) { log('Яндекс: страница поиска — ошибка ' + err.message); return { error: err.message }; }
  });
  let stationsCache = null;
  ipcMain.handle('ym-stations', async () => {
    if (stationsCache && Date.now() - stationsCache.at < 6 * 3600 * 1000) return stationsCache.list;
    try { const list = await ym.stationsList(getYmToken()); stationsCache = { at: Date.now(), list }; log('Яндекс: станций ' + list.length); return list; }
    catch (err) { log('Яндекс: список станций — ошибка ' + err.message); return []; }
  });
  ipcMain.handle('ym-wave-variants', async () => {
    const tok = getYmToken();
    if (!tok) return { presets: [], dashboard: [] };
    let presets = [], dashboard = [];
    try { presets = await ym.wavePresets(tok); } catch (err) { log('Волна: варианты — ' + err.message); }
    try { dashboard = await ym.stationsDashboard(tok); } catch (err) { log('Волна: подборка станций — ' + err.message); }
    return { presets, dashboard: dashboard.slice(0, 10) };
  });
  async function ymUidGet() {
    if (ymUid) return ymUid;
    const a = await ym.accountStatus(getYmToken());
    ymUid = a.uid || a.login;
    return ymUid;
  }
  ipcMain.handle('ym-my', async () => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { return { playlists: await ym.userPlaylists(tok, await ymUidGet()) }; }
    catch (err) { log('Яндекс: мои плейлисты — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-liked', async () => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { return Object.assign({ src: 'ym', type: 'liked' }, await ym.likedTracks(tok, await ymUidGet(), 1000)); }
    catch (err) { log('Яндекс: «Мне нравится» — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-playlist', async (e, pl) => {
    try { return await ym.playlistTracks(getYmToken(), pl || {}); }
    catch (err) { log('Яндекс: плейлист — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-like-ids', async () => {
    const tok = getYmToken();
    if (!tok) return [];
    try { return await ym.likedIds(tok, await ymUidGet()); }
    catch (err) { log('Яндекс: список лайков — ' + err.message); return []; }
  });
  ipcMain.handle('ym-like', async (e, trackKey, on) => {
    const tok = getYmToken();
    if (!tok) return { error: 'войди в Яндекс' };
    try { await ym.setLike(tok, await ymUidGet(), trackKey, !!on); log('Яндекс: ' + (on ? 'лайк ' : 'снят лайк ') + trackKey); return { ok: true }; }
    catch (err) { log('Яндекс: лайк — ' + err.message); return { error: err.message }; }
  });
  ipcMain.handle('ym-artist', async (e, id) => {
    try { return await ym.artistTracks(getYmToken(), id); }
    catch (err) { log('Яндекс: исполнитель — ' + err.message); return { error: err.message }; }
  });

  // Ссылка в строке поиска: Яндекс Музыка или YouTube
  ipcMain.handle('resolve-link', async (e, text) => {
    const t = String(text || '').trim();
    let u;
    try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch (err) { return null; }
    const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase();
    const p = u.pathname;
    const tok = getYmToken();
    try {
      if (/^music\.yandex\.(ru|com|by|kz|uz)$/.test(host)) {
        let m;
        if ((m = /\/track\/(\d+)/.exec(p))) { const tr = await ym.trackById(tok, m[1]); return tr ? { tracks: [tr] } : { error: 'трек не найден' }; }
        if ((m = /^\/album\/(\d+)/.exec(p))) return { list: await ym.albumTracks(tok, m[1]) };
        if ((m = /^\/users\/([^/]+)\/playlists\/(\d+)/.exec(p))) return { list: await ym.playlistTracks(tok, { uid: decodeURIComponent(m[1]), kind: m[2] }) };
        if ((m = /^\/playlists\/([^/?#]+)/.exec(p))) return { list: await ym.playlistTracks(tok, { uuid: m[1] }) };
        if ((m = /^\/artist\/(\d+)/.exec(p))) return { list: await ym.artistTracks(tok, m[1]) };
        return { error: 'такую ссылку Яндекса пока не понимаю' };
      }
      if (/^(youtube\.com|music\.youtube\.com|youtu\.be)$/.test(host)) {
        const vid = host === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || ((/^\/(shorts|live|embed)\/([\w-]{6,})/.exec(p) || [])[2]));
        const list = u.searchParams.get('list');
        const out = {};
        if (vid) {
          try {
            const v = await yts({ videoId: vid });
            out.tracks = [{ src: 'yt', id: vid, title: v.title || '', author: (v.author && v.author.name) || '', duration: v.timestamp || (v.duration && v.duration.timestamp) || '', seconds: v.seconds || 0, thumb: v.thumbnail || ('https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg') }];
          } catch (err) {
            out.tracks = [{ src: 'yt', id: vid, title: 'Видео YouTube', author: '', duration: '', seconds: 0, thumb: 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg' }];
          }
        }
        if (list && !/^(RD|UL|LL|WL)/.test(list)) { // миксы и «Смотреть позже» — не настоящие плейлисты
          const pl = await ytdlpPlaylist(list);
          if (!pl.error) out.list = pl; else if (!vid) return { error: pl.error };
        }
        return (out.tracks || out.list) ? out : { error: 'не нашёл видео по ссылке' };
      }
    } catch (err) { log('ссылка: ошибка ' + err.message); return { error: err.message }; }
    return null; // не ссылка на музыку — обычный поиск
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
  // «Моя волна»
  ipcMain.handle('ym-wave-start', async (e, s) => {
    const tok = getYmToken();
    if (!tok) return { error: 'для волны войди в Яндекс' };
    try {
      const tracks = await ym.waveStart(tok, s || {});
      log('Волна: старт ' + ((s && (s.station || (s.seeds || []).join(','))) || 'user:onyourwave') + ' (характер ' + (s && s.diversity) + ', настроение ' + (s && s.mood) + ', язык ' + (s && s.language) + ')');
      return { tracks };
    } catch (err) { log('Волна: ошибка старта ' + err.message); return { error: 'Волна: ' + err.message }; }
  });
  ipcMain.handle('ym-wave-more', async (e, lastId) => {
    const tok = getYmToken();
    if (!tok) return { error: 'нет входа в Яндекс' };
    try { return { tracks: await ym.waveTracks(tok, lastId) }; }
    catch (err) { log('Волна: ошибка подгрузки ' + err.message); return { error: 'Волна: ' + err.message }; }
  });
  ipcMain.on('ym-wave-feedback', (e, type, trackKey, played) => {
    const tok = getYmToken();
    if (tok) ym.waveFeedback(tok, type, trackKey, played);
  });

  ipcMain.handle('suggest', async (e, part) => {
    try { const a = await ym.suggest(part, getYmToken()); if (a.length) return { source: 'ym', items: a }; }
    catch (err) { log('Яндекс: подсказки — ошибка ' + err.message); }
    try { const b = await ytSuggest(part); if (b.length) return { source: 'yt', items: b }; }
    catch (err) { log('YouTube: подсказки — ошибка ' + err.message); }
    return { source: '', items: [] };
  });

  // «Сейчас играет» — подсказка на значке в трее
  ipcMain.on('now-playing', (e, info) => {
    lastNpInfo = info;
    const line = formatNowPlaying(info, '{artist} — {title}');
    try { if (tray) tray.setToolTip(line ? '♪ ' + line.slice(0, 110) : 'Тапёр'); } catch (err) {}
    writeNowPlaying(info);
  });
  ipcMain.handle('np-path', () => npFilePath());
  writeNowPlaying(null); // при запуске ничего не играет
  app.on('before-quit', () => writeNowPlaying(null));

  // Обновления из шапки
  ipcMain.handle('update-get-state', () => updateState);
  ipcMain.handle('update-check', () => { checkForUpdates(true); return true; });
  ipcMain.handle('update-download', () => {
    installRequested = true;
    if (updateState.state === 'ready' || updateState.state === 'downloading') return true; // уже качается/скачано
    sendUpdateState({ state: 'downloading', percent: 0 });
    autoUpdater.downloadUpdate().catch((e) => sendUpdateState({ state: 'error', message: String(e && e.message || e).slice(0, 300) }));
    return true;
  });
  ipcMain.on('player-busy', (e, busy) => { playerBusy = !!busy; });

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
