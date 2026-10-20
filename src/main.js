const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme, safeStorage, clipboard, globalShortcut, session } = require('electron');
const ym = require('./yandex');
const dz = require('./deezer');
const lastfm = require('./lastfm');
const match = require('./match');
const ymweb = require('./ymweb');
const ytauth = require('./ytauth');
const ytoauth = require('./ytoauth');
const recipes = require('./recipes');
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
  autoUpdate: true, autoStart: false, closeToTray: true,
  theme: 'violet',
  normalize: true, crossfade: 6,
  ytEnabled: true, ymWebFallback: true, ytUseCookies: false, scEnabled: true, auEnabled: true,
  mediaKeys: true,
  hotkeys: { playPause: 'Ctrl+Alt+P', next: 'Ctrl+Alt+Right', prev: 'Ctrl+Alt+Left', like: 'Ctrl+Alt+L', shake: 'Ctrl+Alt+S', volUp: 'Ctrl+Alt+Up', volDown: 'Ctrl+Alt+Down' }
};
function cfg(key) { const s = readSettingsFile(); return s[key] !== undefined ? s[key] : DEFAULTS[key]; }
// Простое хранилище для модулей входа (ключи шифруются внутри модулей)
const settingsStore = {
  get: (k) => readSettingsFile()[k],
  set: (k, v) => { const s = readSettingsFile(); if (v == null) delete s[k]; else s[k] = v; try { fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2)); } catch (e) { log('настройки: ошибка записи ' + e.message); } }
};
function ytCookieFile() { return path.join(app.getPath('userData'), 'yt-cookies.txt'); }
function ytCookieArgs(forStream) { return (ytauth.hasCookies() && (!forStream || cfg('ytUseCookies'))) ? ['--cookies', ytCookieFile()] : []; }
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
function ytdlpBundled() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'yt-dlp.exe');
  return path.join(__dirname, '..', 'resources', 'yt-dlp.exe');
}
// Рабочая копия yt-dlp лежит в папке данных — её можно обновлять, не дожидаясь новой версии Тапёра
function ytdlpUserPath() { return path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe'); }
function ytdlpPath() { const u = ytdlpUserPath(); return fs.existsSync(u) ? u : ytdlpBundled(); }
function ytdlpVersion(bin) {
  return new Promise((resolve) => {
    if (!fs.existsSync(bin)) { resolve(''); return; }
    execFile(bin, ['--version'], { timeout: 20000, windowsHide: true }, (err, out) => resolve(err ? '' : String(out || '').trim()));
  });
}
async function ensureYtdlp() {
  const b = ytdlpBundled(), u = ytdlpUserPath();
  if (!fs.existsSync(b)) return;
  try {
    let copy = !fs.existsSync(u);
    if (!copy) { const [vb, vu] = await Promise.all([ytdlpVersion(b), ytdlpVersion(u)]); copy = !vu || (vb && vb > vu); }
    if (copy) { fs.mkdirSync(path.dirname(u), { recursive: true }); fs.copyFileSync(b, u); log('yt-dlp: рабочая копия обновлена из установки'); }
  } catch (e) { log('yt-dlp: не удалось сделать рабочую копию — ' + e.message); }
}
// yt-dlp сам скачивает свежую версию (YouTube часто ломает старые)
function ytdlpUpdate() {
  return new Promise((resolve) => {
    const u = ytdlpUserPath();
    if (!fs.existsSync(u)) { resolve({ ok: false, text: 'нет рабочей копии' }); return; }
    execFile(u, ['-U'], { timeout: 180000, windowsHide: true }, (err, out, errOut) => {
      const txt = String(out || '') + String(errOut || '');
      const m = /Updated yt-dlp to\s+\S*?([\d.]{8,})/i.exec(txt) || /yt-dlp is up to date \(\S*?([\d.]{8,})/i.exec(txt);
      if (err && !m) { log('yt-dlp: обновление не удалось — ' + txt.trim().slice(-300)); resolve({ ok: false, text: txt.trim().slice(-200) }); return; }
      const updated = /Updated yt-dlp/i.test(txt);
      if (updated) log('yt-dlp: обновлён до ' + (m ? m[1] : '?'));
      resolve({ ok: true, updated, version: m ? m[1] : '' });
    });
  });
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
    execFile(bin, ['https://www.youtube.com/playlist?list=' + listId, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', '500', ...ytCookieArgs(false)],
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

// --- SoundCloud, Bandcamp и другие сайты через yt-dlp ---
function bestThumb(e) {
  const t = (e.thumbnails || []).filter((x) => x && x.url);
  const mid = t.find((x) => /t300x300|t500x500|_7\.|_16\./.test(x.url)) || t.find((x) => (x.width || 0) >= 200) || t[t.length - 1];
  return (mid && mid.url) || e.thumbnail || '';
}
function srcOfUrl(u) { return /bandcamp\.com/i.test(u || '') ? 'bc' : 'sc'; }
function mapYdl(e, src) {
  const url = e.webpage_url || (/^https?:/.test(e.url || '') ? e.url : '') || e.original_url || '';
  return { src: src || srcOfUrl(url), id: url, title: e.track || e.title || 'Без названия', author: e.artist || e.uploader || e.channel || '', seconds: Math.round(e.duration || 0), duration: fmtDur(e.duration), thumb: bestThumb(e) };
}
function ydlJson(args, timeout) {
  return new Promise((resolve) => {
    const bin = ytdlpPath();
    if (!fs.existsSync(bin)) { resolve({ error: 'yt-dlp не найден' }); return; }
    execFile(bin, [...args, '--dump-single-json', '--no-warnings'], { timeout: timeout || 45000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { resolve({ error: String(stderr || err.message).trim().split('\n').pop().slice(0, 300) }); return; }
      try { resolve(JSON.parse(stdout)); } catch (e) { resolve({ error: 'ошибка разбора' }); }
    });
  });
}
async function scSearch(q, n) {
  const j = await ydlJson(['scsearch' + (n || 15) + ':' + q, '--flat-playlist'], 30000);
  if (j.error) { log('SoundCloud: поиск — ' + j.error); return { error: j.error }; }
  return (j.entries || []).filter((e) => e && (e.webpage_url || e.url)).map((e) => mapYdl(e, 'sc'));
}
async function urlList(url) {
  const j = await ydlJson([url, '--flat-playlist', '--playlist-end', '500'], 60000);
  if (j.error) { log('список по ссылке: ' + j.error); return { error: j.error }; }
  const src = srcOfUrl(url);
  if (!j.entries) return { tracks: [mapYdl(j, src)] };
  const tracks = j.entries.filter((e) => e && (e.webpage_url || e.url)).map((e) => mapYdl(e, src));
  return { list: { src, type: 'playlist', listId: url, title: j.title || 'Плейлист', author: j.uploader || j.artist || '', count: tracks.length, thumb: bestThumb(j) || (tracks[0] && tracks[0].thumb) || '', tracks } };
}
// Поток звука по ссылке: обычный файл или HLS (тогда окно играет его через hls.js)
function urlStream(url) {
  return new Promise((resolve) => {
    const bin = ytdlpPath();
    if (!fs.existsSync(bin)) { resolve({ error: 'yt-dlp не найден' }); return; }
    execFile(bin, ['-f', 'ba[protocol^=http]/ba/b', '--print', '%(protocol)s|%(url)s', '--no-playlist', '--no-warnings', url], { timeout: 30000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) { const m = String(stderr || err.message).trim().split('\n').pop(); log('поток по ссылке: ' + m); resolve({ error: m.slice(0, 300) }); return; }
      const line = String(stdout || '').trim().split(/\r?\n/).pop() || '';
      const i = line.indexOf('|'); const proto = line.slice(0, i), u = line.slice(i + 1);
      if (!/^https?:/.test(u)) { resolve({ error: 'поток не получен' }); return; }
      resolve({ audioUrl: u, hls: /m3u8/.test(proto) || /\.m3u8/.test(u) });
    });
  });
}

// --- Audius: открытая площадка независимых артистов (свой API) ---
const AUDIUS = 'https://api.audius.co/v1';
const AU_APP = 'Tapyor';
async function auSearch(q, n) {
  const { net } = require('electron');
  try {
    const r = await net.fetch(AUDIUS + '/tracks/search?query=' + encodeURIComponent(q) + '&app_name=' + AU_APP + '&limit=' + (n || 10), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) { const err = r.status === 401 || r.status === 403 ? 'Audius просит ключ разработчика' : 'HTTP ' + r.status; log('Audius: поиск — ' + err); return { error: err }; }
    const j = await r.json();
    return (j.data || []).filter((t) => t && t.id && t.is_streamable !== false).slice(0, n || 10).map((t) => ({
      src: 'au', id: String(t.id), title: t.title || 'Без названия', author: (t.user && t.user.name) || '',
      seconds: t.duration || 0, duration: fmtDur(t.duration), link: t.permalink ? 'https://audius.co' + t.permalink : '',
      thumb: (t.artwork && (t.artwork['480x480'] || t.artwork['150x150'])) || ''
    }));
  } catch (e) { log('Audius: поиск — ' + e.message); return { error: e.message }; }
}
function auStreamUrl(id) { return AUDIUS + '/tracks/' + encodeURIComponent(id) + '/stream?app_name=' + AU_APP; }

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
      ...ytCookieArgs(true),
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


// --- Глобальные горячие клавиши: работают, даже когда в фокусе игра ---
const HOTKEY_ACTIONS = ['playPause', 'next', 'prev', 'like', 'shake', 'volUp', 'volDown'];
function sendHotkey(action) {
  try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('hotkey', action); } catch (e) {}
}
function applyHotkeys() {
  const failed = [];
  try { globalShortcut.unregisterAll(); } catch (e) {}
  const reg = (acc, action) => {
    if (!acc) return;
    let ok = false;
    try { ok = globalShortcut.register(acc, () => sendHotkey(action)); } catch (e) { ok = false; }
    if (!ok) { failed.push(acc); log('горячие клавиши: занято или неверно — ' + acc); }
  };
  if (cfg('mediaKeys')) {
    reg('MediaPlayPause', 'playPause');
    reg('MediaNextTrack', 'next');
    reg('MediaPreviousTrack', 'prev');
  }
  const hk = Object.assign({}, DEFAULTS.hotkeys, cfg('hotkeys') || {});
  HOTKEY_ACTIONS.forEach((a) => reg(hk[a], a));
  return { failed };
}

// Ровная громкость: окну нужно «видеть» звук, а потоки Яндекса и YouTube приходят с чужих сайтов.
// Разрешаем окну программы анализировать звук (добавляем заголовок CORS к медиа-ответам).
function allowMediaAnalysis() {
  try {
    session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://*/*'] }, (d, cb) => {
      const cdn = /^https:\/\/[^/]*(sndcdn\.com|soundcloud\.cloud|bcbits\.com)\//i.test(d.url || '');
      if (d.resourceType !== 'media' && !(cdn && (d.resourceType === 'xhr' || d.resourceType === 'fetch'))) { cb({}); return; }
      const h = Object.assign({}, d.responseHeaders);
      const has = Object.keys(h).some((k) => k.toLowerCase() === 'access-control-allow-origin');
      if (!has) h['Access-Control-Allow-Origin'] = ['*'];
      cb({ responseHeaders: h });
    });
  } catch (e) { log('ровная громкость: не удалось разрешить анализ звука ' + e.message); }
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
    backgroundColor: themeColors().bg,
    title: 'Тапёр',
    show: !startHidden,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    // Тёмная верхняя полоса в цвет оформления; системные кнопки остаются
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: themeColors().bg, symbolColor: themeColors().sym, height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // вкладка «Браузер»: сайты сервисов
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

// Цвета системной полосы окна под тему оформления
function themeColors() { return cfg('theme') === 'mono' ? { bg: '#161616', sym: '#CBCBCB' } : { bg: '#15161C', sym: '#C9CBD4' }; }
function applyThemeWindow() {
  try { if (mainWindow && !mainWindow.isDestroyed()) { const c = themeColors(); mainWindow.setBackgroundColor(c.bg); mainWindow.setTitleBarOverlay({ color: c.bg, symbolColor: c.sym, height: 36 }); } } catch (e) { log('тема: ' + e.message); }
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray16.png')); // tray16@2x.png Windows возьмёт сам на экранах 200%
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
  // YouTube в России часто открывается только через VPN — не ждём его дольше 8 секунд
  const ytsT = (q, ms) => Promise.race([yts(q), new Promise((_, rej) => setTimeout(() => rej(new Error('YouTube не отвечает')), ms || 8000))]);
  ipcMain.handle('yt-search', async (event, query) => {
    try {
      const r = await ytsT(query);
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
  ipcMain.handle('yt-playlist', async (e, listId, title) => {
    if (ytoauth.loggedIn()) {
      try { return await ytoauth.playlistTracks(listId, title); }
      catch (err) { log('YouTube API: плейлист — ' + err.message + ' (пробую yt-dlp)'); }
    }
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
  const urlCache = new Map();
  ipcMain.handle('url-stream', async (e, url) => {
    const c = urlCache.get(url); if (c && Date.now() - c.at < 30 * 60 * 1000) return c.value;
    const r = await urlStream(url); if (r && r.audioUrl) urlCache.set(url, { at: Date.now(), value: r });
    return r;
  });
  ipcMain.handle('sc-search', (e, q, n) => (cfg('scEnabled') === false ? [] : scSearch(q, n)));
  ipcMain.handle('au-search', (e, q, n) => (cfg('auEnabled') === false ? [] : auSearch(q, n)));
  ipcMain.handle('au-stream', (e, id) => ({ audioUrl: auStreamUrl(id) }));
  ipcMain.handle('url-list', async (e, url) => { const r = await urlList(url); return r.list || r; });
  ipcMain.handle('yt-search-more', (event, query, count) => ytdlpSearch(query, Math.min(Math.max(count || 40, 20), 300)));

  // Настройки (запоминаются между запусками)
  const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
  const readSettings = () => { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { return {}; } };
  ipcMain.handle('get-setting', (e, key) => { const v = readSettings()[key]; return v !== undefined ? v : DEFAULTS[key]; });
  ipcMain.handle('set-setting', (e, key, value) => {
    const s = readSettings(); s[key] = value;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); }
    if (key === 'autoStart') applyAutoStart();
    if (key === 'theme') applyThemeWindow();
    if (key === 'mediaKeys' || key === 'hotkeys') return applyHotkeys();
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
    if (/^https:\/\/([a-z0-9-]+\.)*(yandex\.(ru|com|by|kz)|ya\.ru|youtube\.com|youtu\.be|soundcloud\.com|bandcamp\.com|audius\.co)\//i.test(String(url || ''))) shell.openExternal(url);
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
  // Плейлист из текста: найти одну строку (Яндекс, если не точно — ещё YouTube)
  ipcMain.handle('match-line', async (e, line) => {
    const q = match.clean(line);
    if (!q.query) return { status: 'skip' };
    let ymList = [], ytList = [];
    try { ymList = (await ym.searchTracksPage(q.query, 0, getYmToken())).slice(0, 6); } catch (err) { log('из текста: Яндекс — ' + err.message); }
    let r = match.decide(q, ymList, []);
    if (r.status !== 'exact' && cfg('ytEnabled') !== false) {
      try {
        const y = await ytsT(q.query, 8000);
        ytList = (y.videos || []).slice(0, 5).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail }));
      } catch (err) { log('из текста: YouTube — ' + err.message); }
      r = match.decide(q, ymList, ytList);
    }
    return Object.assign({ query: q.query }, r);
  });
  ipcMain.handle('ym-create-playlist', async (e, title, tracks) => {
    const tok = getYmToken();
    if (!tok) return { error: 'нет входа в Яндекс' };
    try {
      const uid = await ymUidGet();
      const p = await ym.createPlaylist(tok, uid, String(title || 'Плейлист из Тапёра').slice(0, 100));
      const r = await ym.addToPlaylist(tok, uid, p.kind, p.revision, tracks || []);
      log('Яндекс: создан плейлист «' + title + '», треков ' + r.count);
      return { ok: true, kind: r.kind, uid: uid, count: r.count };
    } catch (err) { log('Яндекс: создание плейлиста — ' + err.message); return { error: err.message }; }
  });
  // Цвет обложки для «сцены»: уменьшаем картинку и берём средний цвет с упором на насыщенные пиксели
  const coverColors = new Map();
  ipcMain.handle('cover-color', async (e, url) => {
    if (!url || !/^https:\/\//i.test(url)) return null;
    if (coverColors.has(url)) return coverColors.get(url);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const img0 = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()));
      if (img0.isEmpty()) return null;
      const px = img0.resize({ width: 24, height: 24 }).toBitmap(); // BGRA
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i + 3 < px.length; i += 4) {
        const B = px[i], G = px[i + 1], R = px[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = mx ? (mx - mn) / mx : 0;
        const w = sat * sat * (mx / 255) + 0.02;
        r += R * w; g += G * w; b += B * w; n += w;
      }
      r /= n; g /= n; b /= n;
      const k = 210 / Math.max(r, g, b, 1); // ровная яркость свечения
      const hex = '#' + [r, g, b].map((x) => Math.round(Math.min(255, x * k)).toString(16).padStart(2, '0')).join('');
      if (coverColors.size > 300) coverColors.clear();
      coverColors.set(url, hex);
      return hex;
    } catch (err) { return null; }
  });
  ipcMain.handle('ym-artist', async (e, id) => {
    try { return await ym.artistTracks(getYmToken(), id); }
    catch (err) { log('Яндекс: исполнитель — ' + err.message); return { error: err.message }; }
  });

  ipcMain.handle('ym-album', async (e, id) => {
    try { return await ym.albumTracks(getYmToken(), id); }
    catch (err) { log('Яндекс: альбом — ' + err.message); return { error: err.message }; }
  });
  // Страница исполнителя: Яндекс (играет сразу) + Deezer (полная дискография, без ключа)
  ipcMain.handle('artist-page', async (e, name, ymId) => {
    const tok = getYmToken();
    const out = { name: name || '', errors: [] };
    const nn = dz.norm(name);
    const ymP = (async () => {
      let id = ymId;
      if (!id && name) {
        const r = await ym.search(name, tok);
        const a = (r.artists || []).find((x) => dz.norm(x.name) === nn) || null;
        id = a && a.id;
      }
      return id ? ym.artistInfo(tok, id) : null;
    })().catch((err) => { out.errors.push('Яндекс: ' + err.message); log('исполнитель: Яндекс — ' + err.message); return null; });
    const dzP = dz.artistPage(name).catch((err) => { out.errors.push('Deezer: ' + err.message); log('исполнитель: Deezer — ' + err.message); return null; });
    const lfP = lastfm.configured() ? lastfm.artist(name).catch((err) => { out.errors.push(err.message); log('исполнитель: ' + err.message); return null; }) : Promise.resolve(null);
    const [y, d, lf] = await Promise.all([ymP, dzP, lfP]);
    out.ym = y; out.dz = d; out.lf = lf;
    log('исполнитель «' + name + '»: Яндекс ' + (y ? y.albums.length + ' альб.' : 'нет') + ', Deezer ' + (d ? d.albums.length + ' альб.' : 'нет') + ', Last.fm ' + (lf ? 'есть' : (lastfm.configured() ? 'нет' : 'без ключа')));
    return out;
  });
  ipcMain.handle('dz-album', async (e, id) => {
    try { return await dz.album(id); }
    catch (err) { log('Deezer: альбом — ' + err.message); return { error: err.message }; }
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
      if (/^(soundcloud\.com|on\.soundcloud\.com)$/.test(host) || /(^|\.)bandcamp\.com$/.test(host)) {
        const r = await urlList(u.toString());
        return r.error ? { error: (/bandcamp/.test(host) ? 'Bandcamp' : 'SoundCloud') + ': ' + r.error } : r;
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

  // --- Вход в YouTube: через браузер (OAuth), окном внутри Тапёра, ключом из браузера ---
  ytauth.setup({ log, store: settingsStore, cookieFile: ytCookieFile() });
  ytoauth.setup({ log, store: settingsStore });
  ytauth.restore().catch((e) => log('YouTube: восстановление входа — ' + e.message));
  const ytAuthStatus = () => ({
    cookies: settingsStore.get('ytAccount') || null,
    oauth: { configured: ytoauth.configured(), account: ytoauth.loggedIn() ? (settingsStore.get('ytOauthAccount') || { name: 'аккаунт Google' }) : null },
    useCookies: !!cfg('ytUseCookies')
  });
  ipcMain.handle('yt-auth-status', () => ytAuthStatus());
  ipcMain.handle('yt-login-paste', async (e, text) => {
    const t = text != null && String(text).trim() ? String(text) : clipboard.readText();
    let kind = '';
    try { kind = ytauth.parse(t).kind || ''; } catch (e2) {}
    const pasted = { kind, len: String(t || '').length }; // что вставили — без самого ключа
    try { return Object.assign(await ytauth.loginWithText(t), { pasted }); } catch (err) { log('YouTube: ключ — ' + err.message); return { error: 'failed', message: err.message, pasted }; }
  });
  ipcMain.handle('yt-login-window', () => ytauth.loginWindow(mainWindow));
  ipcMain.handle('yt-oauth-login', () => ytoauth.login());
  ipcMain.handle('yt-oauth-cancel', () => { ytoauth.cancel(); return true; });
  ipcMain.handle('yt-logout', async (e, kind) => { if (kind === 'oauth') ytoauth.logout(); else await ytauth.logout(); return ytAuthStatus(); });
  // Мои плейлисты и лайки YouTube: через API (вход через браузер) или через yt-dlp с ключом
  function ytdlpFeed(url, end) {
    return new Promise((resolve) => {
      const bin = ytdlpPath();
      if (!fs.existsSync(bin)) { resolve({ error: 'yt-dlp не найден' }); return; }
      execFile(bin, [url, '--flat-playlist', '--dump-single-json', '--no-warnings', '--playlist-end', String(end || 300), ...ytCookieArgs(false)],
        { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) { log('YouTube: ' + url + ' — ' + String(stderr || err.message).slice(0, 300)); resolve({ error: 'не удалось загрузить' }); return; }
          try { resolve(JSON.parse(stdout)); } catch (e2) { resolve({ error: 'ошибка разбора' }); }
        });
    });
  }
  ipcMain.handle('yt-my', async () => {
    if (ytoauth.loggedIn()) {
      try { return { via: 'api', playlists: await ytoauth.myPlaylists(), liked: { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', listId: 'LL' } }; }
      catch (err) { log('YouTube API: мои плейлисты — ' + err.message); }
    }
    if (!ytauth.hasCookies()) return { error: 'нет входа' };
    const j = await ytdlpFeed('https://www.youtube.com/feed/playlists', 200);
    if (j.error) return j;
    const playlists = (j.entries || []).filter((x) => x && (x.id || x.url)).map((x) => {
      const id = x.id && !/^https?:/.test(x.id) ? x.id : ((/[?&]list=([\w-]+)/.exec(x.url || '') || [])[1]);
      return { src: 'yt', type: 'playlist', listId: id, title: x.title || 'Плейлист', author: x.channel || x.uploader || '', count: x.playlist_count || 0, thumb: (x.thumbnails && x.thumbnails.length ? x.thumbnails[x.thumbnails.length - 1].url : ''), mine: true };
    }).filter((p) => p.listId && p.listId !== 'LL' && p.listId !== 'WL');
    return { via: 'cookies', playlists, liked: { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', listId: 'LL' } };
  });
  ipcMain.handle('yt-liked', async () => {
    if (ytoauth.loggedIn()) { try { return await ytoauth.liked(); } catch (err) { log('YouTube API: лайки — ' + err.message); } }
    const r = await ytdlpPlaylist('LL');
    if (r && !r.error) { r.type = 'liked'; r.title = 'Понравившиеся на YouTube'; }
    return r;
  });

  // --- Запасной способ для Яндекса: официальный сайт в скрытом окне ---
  ymweb.setup({ log, send: (ch, d) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, d); } catch (e) {} } });
  // --- Самопроверка сервисов ---
  recipes.setup({ log, cacheFile: path.join(app.getPath('userData'), 'recipes.json'), appVersion: app.getVersion() });
  recipes.refresh();
  ensureYtdlp();
  let healthRunning = null;
  const step = (name, ok, text, details) => ({ name, ok, text, details: details || '' });
  async function checkYandex() {
    const steps = [];
    const tok = getYmToken();
    if (!tok) return { status: 'skip', title: 'Нет входа в Яндекс — проверять нечего', steps };
    const R = recipes.get().yandex || {};
    let tr = null;
    try {
      const r = await ym.search(R.testQuery || 'Кино Группа крови', tok);
      tr = (r.tracks || []).find((x) => x.albumId) || (r.tracks || [])[0];
      steps.push(step('Поиск в Яндексе', !!tr, tr ? 'работает' : 'ничего не нашёл'));
    } catch (e) { steps.push(step('Поиск в Яндексе', false, 'не работает — Яндекс мог поменять своё API', e.message)); }
    if (!tr) { const last = settingsStore.get('healthYmTrack'); if (last) tr = last; }
    let apiOk = false;
    if (tr) {
      try { const s2 = await ym.streamUrl(tr.id, tok); apiOk = !!(s2 && s2.audioUrl); steps.push(step('Воспроизведение (основной способ)', apiOk, apiOk ? (s2.preview ? 'работает, но только отрывки — нет Плюса' : 'работает') : 'поток не получен')); }
      catch (e) { steps.push(step('Воспроизведение (основной способ)', false, 'не работает — Яндекс мог поменять своё API', e.message)); }
      settingsStore.set('healthYmTrack', { id: tr.id, albumId: tr.albumId, title: tr.title, seconds: tr.seconds });
    }
    let siteOk = null;
    if (!cfg('ymWebFallback')) steps.push(step('Запасной способ (сайт Яндекс Музыки)', null, 'выключен в настройках'));
    else if (tr) {
      const r = await ymweb.play(tr, 0);
      await ymweb.stop();
      siteOk = !!(r && r.ok);
      steps.push(step('Запасной способ (сайт Яндекс Музыки)', siteOk, siteOk ? 'работает' : (r.error || 'не работает'), (r && r.details) || ''));
    }
    const status = apiOk && siteOk !== false ? 'ok' : (apiOk || siteOk ? 'warn' : 'fail');
    const title = status === 'ok' ? 'Работает' : (apiOk ? 'Работает, но запасной способ сломан' : (siteOk ? 'Основной способ сломан — играет через сайт' : 'Не работает — слушай во вкладке «Браузер»'));
    return { status, title, steps };
  }
  async function checkYouTube() {
    const steps = [];
    if (cfg('ytEnabled') === false) return { status: 'skip', title: 'YouTube выключен в настройках', steps };
    const R = recipes.get().youtube || {};
    let net1 = true;
    try { const r = await ytsT(R.testQuery || 'Кино Группа крови', 8000); steps.push(step('Поиск на YouTube', !!(r.videos && r.videos.length), (r.videos && r.videos.length) ? 'работает' : 'ничего не нашёл')); }
    catch (e) { net1 = false; steps.push(step('Поиск на YouTube', false, 'YouTube не отвечает — возможно, нужен VPN на весь компьютер', e.message)); }
    const up = await ytdlpUpdate();
    const ver = await ytdlpVersion(ytdlpPath());
    steps.push(step('Библиотека yt-dlp', !!ver, ver ? 'версия ' + ver + (up.updated ? ' — только что обновлена' : (up.ok ? ', свежая' : ', обновить не удалось')) : 'не найдена', up.ok ? '' : up.text));
    let dlOk = false;
    if (net1) {
      const r = await streamViaYtDlp('https://www.youtube.com/watch?v=' + (R.testVideo || 'jNQXAC9IVRw'));
      dlOk = !!(r && (r.url || r.audioUrl));
      steps.push(step('Воспроизведение (основной способ)', dlOk, dlOk ? 'работает' : 'не работает — включится плеер YouTube', r && r.error ? String(r.error).slice(0, 300) : ''));
    }
    const status = !net1 ? 'fail' : (dlOk ? 'ok' : 'warn');
    const title = status === 'ok' ? 'Работает' : (status === 'warn' ? 'Основной способ сломан — играет через плеер YouTube' : 'YouTube недоступен');
    return { status, title, steps };
  }
  async function checkSoundCloud() {
    if (cfg('scEnabled') === false) return { status: 'skip', title: 'SoundCloud выключен в настройках', steps: [] };
    const steps = [];
    const r = await scSearch('Kino Gruppa krovi', 3);
    const ok = Array.isArray(r) && r.length > 0;
    steps.push(step('Поиск на SoundCloud', ok, ok ? 'работает' : 'не работает', r && r.error ? r.error : ''));
    let st = false;
    if (ok) { const s2 = await urlStream(r[0].id); st = !!(s2 && s2.audioUrl); steps.push(step('Воспроизведение', st, st ? 'работает' + (s2.hls ? ' (поток HLS)' : '') : 'не работает', s2 && s2.error ? s2.error : '')); }
    return { status: ok && st ? 'ok' : (ok ? 'warn' : 'fail'), title: ok && st ? 'Работает' : (ok ? 'Поиск работает, воспроизведение — нет' : 'Не работает'), steps };
  }
  async function checkAudius() {
    if (cfg('auEnabled') === false) return { status: 'skip', title: 'Audius выключен в настройках', steps: [] };
    const r = await auSearch('lofi', 3);
    const ok = Array.isArray(r) && r.length > 0;
    let st = null;
    if (ok) {
      try { const { net } = require('electron'); const s2 = await net.fetch(auStreamUrl(r[0].id), { method: 'GET', headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(10000) }); st = s2.ok || s2.status === 206; }
      catch (e) { st = false; }
    }
    const steps = [step('Поиск на Audius', ok, ok ? 'работает' : ((r && r.error) || 'не работает')), step('Воспроизведение', ok ? st : null, ok ? (st ? 'работает' : 'не работает') : 'не проверялось')];
    return { status: ok && st ? 'ok' : (ok ? 'warn' : 'fail'), title: ok && st ? 'Работает' : (r && r.error ? r.error : 'Не работает'), steps };
  }
  async function runHealth() {
    if (healthRunning) return healthRunning;
    healthRunning = (async () => {
      log('самопроверка: начало');
      await recipes.refresh();
      const res = { at: Date.now(), services: {}, recipes: recipes.info() };
      try { res.services.yandex = await checkYandex(); } catch (e) { res.services.yandex = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.soundcloud = await checkSoundCloud(); } catch (e) { res.services.soundcloud = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.audius = await checkAudius(); } catch (e) { res.services.audius = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      try { res.services.youtube = await checkYouTube(); } catch (e) { res.services.youtube = { status: 'fail', title: 'Проверка не удалась', steps: [step('Проверка', false, e.message)] }; }
      settingsStore.set('health', res);
      log('самопроверка: Яндекс — ' + res.services.yandex.status + ', YouTube — ' + res.services.youtube.status + ', SoundCloud — ' + res.services.soundcloud.status);
      for (const [name, sv] of Object.entries(res.services)) {
        log('самопроверка · ' + name + ': ' + sv.status + (sv.title ? ' — ' + sv.title : ''));
        (sv.steps || []).forEach((st) => log('   ' + (st.ok ? '✓' : '✗') + ' ' + st.name + (st.text ? ': ' + st.text : '') + (st.details ? ' [' + String(st.details).slice(0, 300) + ']' : '')));
      }
      if (res.recipes) log('самопроверка · рецепты: ' + JSON.stringify(res.recipes).slice(0, 300));
      return res;
    })();
    try { return await healthRunning; } finally { healthRunning = null; }
  }
  ipcMain.handle('health-get', () => settingsStore.get('health') || null);
  ipcMain.handle('health-run', () => (playerBusy ? { busy: true } : runHealth()));

  ipcMain.handle('ymweb-play', (e, t, vol) => ymweb.play(t, vol).catch((err) => { log('Яндекс (сайт): ' + err.message); return { error: err.message }; }));
  ipcMain.handle('ymweb-cmd', (e, name, value) => ymweb.cmd(name, value));
  ipcMain.handle('ymweb-stop', () => ymweb.stop());
  ipcMain.handle('ymweb-login', () => ymweb.login());
  app.on('before-quit', () => ymweb.destroy());

  // Тот же трек в другом сервисе (если в своём он не играет)
  ipcMain.handle('find-alt', async (e, t, target) => {
    if (!t || !t.title) return null;
    let line;
    if (t.src === 'yt' || t.src === 'sc' || t.src === 'bc') {
      const ch = String(t.author || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '');
      line = /\s[-–—]\s/.test(t.title) ? t.title : (ch ? ch + ' - ' + t.title : t.title);
    } else line = (t.author ? t.author + ' - ' : '') + t.title;
    const q = match.clean(line);
    if (!q.query) return null;
    let ymList = [], ytList = [];
    try {
      if (target === 'ym') ymList = (await ym.searchTracksPage(q.query, 0, getYmToken())).slice(0, 6);
      else {
        const y = await ytsT(q.query, 8000);
        ytList = (y.videos || []).slice(0, 5).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail }));
      }
    } catch (err) { log('замена трека: поиск — ' + err.message); return { error: err.message }; }
    const r = match.decide(q, ymList, ytList);
    log('замена трека: «' + line + '» → ' + (target === 'ym' ? 'Яндекс' : 'YouTube') + ': ' + r.status + (r.track ? ' «' + (r.track.author || '') + ' — ' + r.track.title + '»' : ''));
    return r.status === 'none' ? null : { status: r.status, track: r.track };
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
  ipcMain.on('log', (e, msg) => log('окно: ' + String(msg).slice(0, 500)));
  ipcMain.on('player-busy', (e, busy) => { playerBusy = !!busy; });
  ipcMain.handle('hotkeys-pause', (e, paused) => { // пока назначаем новое сочетание — старые не мешают
    if (paused) { try { globalShortcut.unregisterAll(); } catch (err) {} return { failed: [] }; }
    return applyHotkeys();
  });
  ipcMain.handle('hotkeys-status', () => applyHotkeys());

  ipcMain.handle('get-log', () => { try { return fs.readFileSync(logPath(), 'utf8').slice(-6000); } catch (e) { return 'лог пуст'; } });
  log('=== приложение запущено, версия ' + app.getVersion() + ' ===');

  allowMediaAnalysis();
  createWindow();
  createTray();
  applyHotkeys();

  // Проверяем обновления при запуске (тихо)
  initUpdater();
  checkForUpdates(false);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Не выходим при закрытии всех окон — живём в трее
// Вкладка «Браузер»: встраиваемые сайты — только сервисы музыки и без доступа к системе
app.on('web-contents-created', (e, contents) => {
  contents.on('will-attach-webview', (ev, wp, params) => {
    delete wp.preload;
    wp.nodeIntegration = false; wp.contextIsolation = true; wp.sandbox = true;
    if (!/^https?:\/\//i.test(params.src || '')) ev.preventDefault(); // вкладка «Браузер»: любые сайты, без доступа к Тапёру (sandbox)
  });
  if (contents.getType() === 'webview') contents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) contents.loadURL(url); return { action: 'deny' }; });
});
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (e) {} });
app.on('window-all-closed', (e) => {
  // на Windows держим процесс ради трея
});
