const { app, BrowserWindow, Tray, Menu, nativeImage, dialog, ipcMain, shell, nativeTheme, safeStorage, clipboard, globalShortcut, session } = require('electron');
const ym = require('./yandex');
const dz = require('./deezer');
const lastfm = require('./lastfm');
const match = require('./match');
const ymweb = require('./ymweb');
const ytauth = require('./ytauth');
const ytoauth = require('./ytoauth');
const recipes = require('./recipes');
const library = require('./library');
const importers = require('./importers');
const reqp = require('./reqparse');
const donations = require('./donations');
const sitepage = require('./sitepage');
const crypto = require('crypto');
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
  theme: 'violet', reportsEnabled: true,
  normalize: true, crossfade: 6,
  ytEnabled: true, ymWebFallback: true, ytUseCookies: false, scEnabled: true, auEnabled: true,
  preferLocal: true, libInSearch: true,
  reqPrice: 100, reqCurrency: 'RUB', reqAuto: false,
  mediaKeys: true,
  widgetPort: 47654, widgetLook: 'current', widgetScale: 100,
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
      if (!updated || !m) { resolve({ ok: true, updated, version: m ? m[1] : '' }); return; }
      // На Windows файл заменяется уже после выхода — ждём, пока новая версия встанет на место (до 10 с)
      let k = 0;
      (function wait() {
        ytdlpVersion(u).then((v) => {
          if (v === m[1] || ++k > 20) { resolve({ ok: true, updated, version: m[1] }); return; }
          setTimeout(wait, 500);
        });
      })();
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
    if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
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
    if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
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
    if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
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
    if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
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
    if (!exists) { resolve({ error: 'движок YouTube не найден' }); return; }
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
        resolve({ error: ('движок YouTube: ' + ((stderr || err.message || '').toString())).slice(0, 400) });
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
let zoomWin = null;   // отдельное окно масштаба — не связано с zoom главного окна
let zoomTheme = null;   // цвета темы для окна масштаба
let zoomAnchor = null, zoomPending = false, zoomShowTimer = null;
let zoomThemeKeyCur = '';
let zoomHidden = true;
let zoomGen = 0;   // поколение окна: защита от старых таймеров
const ZOOM_W = 300, ZOOM_H = 208;
let tray = null;
const startHidden = process.argv.includes('--hidden'); // запуск вместе с Windows — сразу в трей
let appUrl = null;

// Музыка с компьютера через тот же сервер: перемотка (Range), обложки. Чужие сайты из вкладки «Браузер»
// не получат файлы: нужна метка из cookie окна Тапёра (SameSite=Strict) и id файла из списка.
const LOCAL_KEY = crypto.randomBytes(18).toString('hex');
const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', m4b: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', weba: 'audio/webm' };
function cookieKey(req) { const m = /(?:^|;\s*)tapk=([0-9a-f]+)/.exec(req.headers.cookie || ''); return m ? m[1] : ''; }
async function serveLocal(req, res, p) {
  const bad = (code) => { res.writeHead(code); res.end(); };
  if (cookieKey(req) !== LOCAL_KEY) return bad(403);
  const id = p.split('/')[2] || '';
  if (p.startsWith('/lcover/')) {
    const c = await library.cover(id).catch(() => null);
    if (!c) return bad(404);
    res.writeHead(200, { 'Content-Type': c.mime, 'Cache-Control': 'max-age=3600' }); res.end(c.data); return;
  }
  const file = library.pathOf(id);
  if (!file) return bad(404);
  let st; try { st = fs.statSync(file); } catch (e) { return bad(404); }
  const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    let a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : st.size - 1;
    if (!m[1] && m[2]) { a = Math.max(0, st.size - +m[2]); b = st.size - 1; }
    if (a >= st.size || b < a) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); res.end(); return; }
    b = Math.min(b, st.size - 1);
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': 'bytes ' + a + '-' + b + '/' + st.size, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file, { start: a, end: b }).on('error', () => res.destroy()).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }
}

// ── Виджет для OBS ──────────────────────────────────────────────────────────
// Отдельная страница /widget, которую OBS берёт источником «Браузер».
// Приложение присылает ей состояние по SSE, а она возвращает команды плееру.
const widgetClients = new Set();
let widgetState = { orders: [], np: { title: '', artist: '', playing: false }, reqAuto: false, scale: 100, theme: null };
let serverPort = 0;
let httpServerRef = null;
let dockGuard = null;

function widgetBroadcast() {
  const payload = 'data: ' + JSON.stringify(widgetState) + '\n\n';
  for (const res of widgetClients) {
    try { res.write(payload); } catch (e) { widgetClients.delete(res); }
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 200000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// Крошечный локальный веб-сервер — отдаёт страницу приложения по http,
// чтобы встроенный плеер YouTube работал (из file:// он не запускается).
// Свободен ли порт: если занят, вернём 0 (система даст любой свободный)
function pickPort(preferred) {
  return new Promise((resolve) => {
    if (!preferred) return resolve(0);
    const probe = http.createServer();
    probe.once('error', () => resolve(0));
    probe.listen(preferred, '127.0.0.1', () => probe.close(() => resolve(preferred)));
  });
}

function startServer(preferredPort) {
  const root = __dirname;
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';

    // Виджет OBS: страница, поток состояния и команды плееру
    if (p === '/widget' || p === '/widget/') {
      fs.readFile(path.join(root, 'widget.html'), (err, data) => {
        if (err) { res.writeHead(500); res.end('widget not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(data);
      });
      return;
    }
    if (p === '/app.css') {
      try {
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const m = /<style>([\s\S]*?)<\/style>/.exec(html);
        res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(m ? m[1] : '');
      } catch (e) {
        res.writeHead(500); res.end('');
      }
      return;
    }
    if (p === '/widget/rq' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        log('док: клик ' + JSON.stringify(body && body.dataset ? body.dataset : body));
        if (body && body.focus) {
          // Кнопка, которая открывает окно приложения (поиск, настройки): показываем его поверх всех
          dockGuard = null;
          if (typeof showMainWindow === 'function') showMainWindow();
        } else if (mainWindow && !mainWindow.isDestroyed()) {
          // Остальные действия (в очередь, пауза) не должны поднимать окно плеера
          dockGuard = { focused: mainWindow.isFocused(), minimized: mainWindow.isMinimized(), at: Date.now() };
          setTimeout(() => {
            if (!dockGuard || Date.now() - dockGuard.at > 2500 || !mainWindow || mainWindow.isDestroyed()) return;
            if (dockGuard.minimized && !mainWindow.isMinimized()) mainWindow.minimize();
            else if (!dockGuard.focused && mainWindow.isFocused()) mainWindow.blur();
            dockGuard = null;
          }, 900);
        }
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('widget-rq', body || {});
      } catch (e) {
        log('док: клик ' + e.message);
      }
      res.writeHead(204); res.end();
      return;
    }
    if (p === '/widget/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(widgetState));
      return;
    }
    if (p === '/widget/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('retry: 2000\n\n');
      res.write('data: ' + JSON.stringify(widgetState) + '\n\n');
      widgetClients.add(res);
      // Каждые 4 секунды — короткий сигнал «жив», чтобы док видел, что связь есть
      const hb = setInterval(() => {
        try { res.write('data: {"hb":1}\n\n'); } catch (e) { clearInterval(hb); widgetClients.delete(res); }
      }, 4000);
      req.on('close', () => { clearInterval(hb); widgetClients.delete(res); });
      return;
    }
    if (p.startsWith('/widget/cmd/')) {
      const action = p.slice('/widget/cmd/'.length);
      // Поиск из панели: показываем окно плеера поверх и ставим курсор в строку поиска
      if (action === 'search' && typeof showMainWindow === 'function') showMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('widget-cmd', action);
      res.writeHead(204); res.end();
      return;
    }
    if (p === '/widget/setting' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        if (body && typeof body.key === 'string') {
          const s = readSettingsFile();
          s[body.key] = body.value;
          fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('widget-setting', { key: body.key, value: body.value });
          if (body.key === 'widgetPort') restartServer(Number(body.value) || 0);
        }
      } catch (e) {
        log('виджет: настройки ' + e.message);
      }
      res.writeHead(204); res.end();
      return;
    }

    // Свои файлы с компьютера: только из списка Тапёра и только для окна Тапёра (метка в cookie)
    if (p.startsWith('/lfile/') || p.startsWith('/lcover/')) { serveLocal(req, res, p); return; }
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || /^(da|github-oauth|google-oauth|lastfm)\.json$/i.test(path.basename(file))) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const hd = { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' };
      // Локальная отдача без кэша: иначе после обновления Chromium может показать старую страницу
      if (/\.(html|js|css)$/i.test(path.extname(file))) hd['Cache-Control'] = 'no-store';
      if (p === '/index.html') hd['Set-Cookie'] = 'tapk=' + LOCAL_KEY + '; Path=/; HttpOnly; SameSite=Strict';
      res.writeHead(200, hd);
      res.end(data);
    });
  });
  httpServerRef = server;
  return pickPort(preferredPort).then((port) => new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      serverPort = server.address().port;
      log('сервер на порту ' + serverPort + (preferredPort && serverPort !== preferredPort ? ' (запрошен ' + preferredPort + ', занят)' : ''));
      resolve(serverPort);
    });
  }));
}

// ── Пипетка по всему экрану ────────────────────────────────────────────────
// Обычная <input type="color"> в Electron показывает лупу только внутри окна.
// Здесь снимаем весь экран и открываем прозрачное окно-оверлей во весь монитор:
// лупа ездит под курсором по любым приложениям, клик забирает цвет.
const { screen, desktopCapturer } = require('electron');
let pickSession = null;

async function pickScreenColor() {
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const scale = display.scaleFactor || 1;
  const thumbW = Math.round(display.size.width * scale);
  const thumbH = Math.round(display.size.height * scale);
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: thumbW, height: thumbH } });
  const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!src || src.thumbnail.isEmpty()) return null;
  const shot = src.thumbnail.getSize();
  // cssW/cssH — размер экрана в логических пикселях; scale — сколько физических на логический
  pickSession = {
    dataUrl: src.thumbnail.toDataURL(),
    scale: shot.width / display.bounds.width,
    cssW: display.bounds.width,
    cssH: display.bounds.height,
    imgW: shot.width,
    imgH: shot.height
  };
  log('пипетка: экран ' + display.bounds.width + 'x' + display.bounds.height + ' (x' + scale + '), снимок ' + shot.width + 'x' + shot.height + ', рабочих ' + display.workAreaSize.width + 'x' + display.workAreaSize.height);

  return await new Promise((resolve) => {
    const win = new BrowserWindow({
      x: display.bounds.x, y: display.bounds.y,
      width: display.bounds.width, height: display.bounds.height,
      frame: false, transparent: true, backgroundColor: '#00000000',
      alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
      show: false, enableLargerThanScreen: true,
      webPreferences: { preload: path.join(__dirname, 'pick-preload.js'), contextIsolation: true, sandbox: false }
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(__dirname, 'pick.html'));
    win.once('ready-to-show', () => {
      win.setBounds({ x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
      win.show(); win.focus();
      setTimeout(() => { try { log('пипетка: окно ' + JSON.stringify(win.getBounds()) + ', контент ' + JSON.stringify(win.getContentBounds())); } catch (e) {} }, 300);
    });

    let finished = false;
    const finish = (val) => {
      if (finished) return;
      finished = true;
      try { ipcMain.removeListener('pick-done', onDone); } catch (e) {}
      try { if (!win.isDestroyed()) win.close(); } catch (e) {}
      pickSession = null;
      resolve(val);
    };
    const onDone = (e, val) => { if (e.sender === win.webContents) finish(val); };
    ipcMain.on('pick-done', onDone);
    win.on('closed', () => { if (!finished) { finished = true; ipcMain.removeListener('pick-done', onDone); pickSession = null; resolve(null); } });
  });
}

// Масштаб интерфейса: zoomFactor + пропорциональный минимум окна,
// чтобы при уменьшении масштаба окно можно было сжимать дальше.
const UI_MIN_W = 900, UI_MIN_H = 600;
function applyUiZoom(win, f) {
  if (!win) return 1;
  const z = Math.min(1.4, Math.max(0.6, Number(f) || 1));
  win.webContents.setZoomFactor(z);
  try { win.setMinimumSize(Math.max(420, Math.round(UI_MIN_W * z)), Math.max(300, Math.round(UI_MIN_H * z))); } catch (e) {}
  try { if (win && win.webContents) win.webContents.send('ui-zoom-changed', z); } catch (e) {}
  try { if (zoomWin && !zoomWin.isDestroyed()) zoomWin.webContents.send('ui-zoom-changed', z); } catch (e) {}
  return win.webContents.getZoomFactor();
}

// Отдельное окно масштаба: живёт независимо от zoom главного окна
function zoomThemeKey(t) { try { return JSON.stringify(t || {}); } catch (e) { return ''; } }
function loadZoomPage(theme) {
  const q = Buffer.from(JSON.stringify(theme || {}), 'utf8').toString('base64');
  zoomWin.loadFile(path.join(__dirname, 'zoom.html'), { query: { t: q } });
}
function createZoomWindow(theme, gen) {
  zoomWin = new BrowserWindow({
    width: ZOOM_W, height: ZOOM_H, frame: false, resizable: false, show: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    backgroundColor: (theme && theme.bg0) || '#0E0F13',
    parent: mainWindow || undefined,
    webPreferences: { preload: path.join(__dirname, 'zoom-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  zoomWin.setMenuBarVisibility(false);
  zoomThemeKeyCur = zoomThemeKey(theme);
  loadZoomPage(theme);
  // окно масштаба всегда 100%: сбрасываем возможный унаследованный zoom для file://
  try { zoomWin.webContents.setZoomFactor(1); } catch (e) {}
  zoomWin.webContents.on('did-finish-load', () => { try { zoomWin.webContents.setZoomFactor(1); } catch (e) {} });
  zoomWin.on('blur', () => { const w = zoomWin; setTimeout(() => { try { if (w && w === zoomWin && !w.isDestroyed() && !w.isFocused()) { zoomHidden = true; w.destroy(); zoomWin = null; } } catch (e) {} }, 140); });
  zoomWin.once('ready-to-show', () => { if (zoomPending && gen === zoomGen) revealZoomWindow(gen); });
  zoomWin.on('closed', () => { zoomWin = null; });
}
function showZoomWindow(anchor) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (anchor && anchor.theme) zoomTheme = anchor.theme;
  if (zoomWin && !zoomWin.isDestroyed() && !zoomHidden) { zoomHidden = true; zoomWin.destroy(); zoomWin = null; return; }
  // каждый показ — свежее окно: не может показать старый кадр или чужую тему
  zoomPending = true; zoomAnchor = anchor;
  if (zoomWin && !zoomWin.isDestroyed()) { try { zoomWin.destroy(); } catch (e) {} zoomWin = null; }
  createZoomWindow(zoomTheme);
  const send = () => { try { zoomWin.webContents.send('zoom-theme', zoomTheme); } catch (e) {} };
  if (zoomWin.webContents.isLoading()) zoomWin.webContents.once('did-finish-load', send);
  else send();
  clearTimeout(zoomShowTimer);
  zoomShowTimer = setTimeout(() => { if (zoomPending && gen === zoomGen) revealZoomWindow(gen); }, 1500);
}
async function revealZoomWindow() {
  if (!zoomWin || zoomWin.isDestroyed() || !zoomAnchor) { zoomPending = false; return; }
  zoomPending = false; clearTimeout(zoomShowTimer);
  const b = mainWindow.getContentBounds();
  const z = mainWindow.webContents.getZoomFactor();
  const ax = Number(zoomAnchor.right) || 0;
  const ay = Number(zoomAnchor.bottom) || 0;
  let x = b.x + Math.round(ax * z) - ZOOM_W;
  let y = b.y + Math.round(ay * z) + 8;
  try {
    const wa = screen.getDisplayNearestPoint({ x, y }).workArea;
    x = Math.min(Math.max(wa.x + 6, x), wa.x + wa.width - ZOOM_W - 6);
    y = Math.min(Math.max(wa.y + 6, y), wa.y + wa.height - ZOOM_H - 6);
  } catch (e) {}
  zoomWin.setBounds({ x, y, width: ZOOM_W, height: ZOOM_H });
  try { zoomWin.setOpacity(0); } catch (e) {}
  zoomWin.show(); zoomWin.focus();
  setTimeout(() => { try { if (gen === zoomGen && zoomWin && !zoomWin.isDestroyed()) zoomWin.setOpacity(1); } catch (e) {} }, 80);
  zoomHidden = false;
  try { zoomWin.webContents.send('ui-zoom-changed', mainWindow.webContents.getZoomFactor()); } catch (e) {}
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
    titleBarOverlay: { color: '#00000000', symbolColor: themeColors().sym, height: 36 }, // прозрачная панель кнопок окна
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true // вкладка «Браузер»: сайты сервисов
    }
  });


  mainWindow.loadURL(appUrl || ('file://' + path.join(__dirname, 'index.html')));

  // Масштаб интерфейса из настроек — применяем до первой отрисовки, без «прыжка»
  mainWindow.webContents.on('did-finish-load', () => {
    applyUiZoom(mainWindow, cfg('uiZoom') || 1);

  });
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
function themeColors() { const t = cfg('theme'); if (t === 'mono') return { bg: '#161616', sym: '#CBCBCB' }; if (t && t !== 'violet') { const b = cfg('themeBar'); if (b && /^#[0-9a-f]{6}$/i.test(b.bg) && /^#[0-9a-f]{6}$/i.test(b.sym)) return b; } return { bg: '#15161C', sym: '#C9CBD4' }; }
function applyThemeWindow() {
  try { if (mainWindow && !mainWindow.isDestroyed()) { const c = themeColors(); mainWindow.setBackgroundColor(c.bg); mainWindow.setTitleBarOverlay({ color: '#00000000', symbolColor: c.sym, height: 36 }); } } catch (e) { log('тема: ' + e.message); }
}
// ===== Отчёты об ошибках: анонимно, без личного, один и тот же «отпечаток» не чаще раза в сутки =====
const REPORT_URL = 'https://functions.yandexcloud.net/d4ehsmee0l5joni3fbkf';
function reportScrub(s) {
  return String(s || '').replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\…').replace(/\/(home|Users)\/[^/\s]+/g, '/$1/…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '…@…').replace(/(token|cookie|sapisid|sid|auth|key|secret|password)[=:]\s*\S+/gi, '$1=…')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '…');
}
function installId() { let id = settingsStore.get('installId'); if (!id) { id = require('crypto').randomUUID(); settingsStore.set('installId', id); } return id; }
let lastReport = null;
async function sendReport(r, force) {
  try {
    if (!force && cfg('reportsEnabled') === false) return { skipped: 'off' };
    const code = String(r.code || '').replace(/\d{4,}/g, '#').slice(0, 40);
    const fp = require('crypto').createHash('sha1').update([r.service, r.stage, code].join('|')).digest('hex').slice(0, 10);
    const sent = settingsStore.get('reportsSent') || {};
    if (!force && sent[fp] && Date.now() - sent[fp] < 24 * 3600 * 1000) return { skipped: 'today' };
    const body = { fp, service: r.service, stage: r.stage, code, msg: reportScrub(r.msg).slice(0, 600), details: reportScrub(r.details).slice(0, 1500),
      app: app.getVersion(), recipes: String((recipes.info() || {}).version || ''), os: process.platform + ' ' + require('os').release(), iid: installId() };
    lastReport = body;
    const { net: enet } = require('electron');
    const res = await enet.fetch(REPORT_URL, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) settingsStore.set('reportsSent', Object.assign({}, sent, { [fp]: Date.now() }));
    log('отчёт об ошибке ' + r.service + '/' + r.stage + ': ' + (res.ok ? 'отправлен' + (j.issue ? ' (задача #' + j.issue + ', пользователей ' + j.users + ')' : '') : 'не отправлен, ' + res.status + ' ' + (j.error || '')));
    return Object.assign({ ok: res.ok, status: res.status }, j);
  } catch (e) { log('отчёт об ошибке: не отправлен — ' + e.message); return { ok: false, error: e.message }; }
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

// Windows не даёт фоновому процессу забрать фокус. Обходим через AttachThreadInput:
// цепляемся к потоку активного окна и уже оттуда поднимаем своё.
function forceForeground(win) {
  try {
    const buf = win.getNativeWindowHandle();
    const hwnd = buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
    const ps = [
      "$sig = '[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h, int c);",
      "[DllImport(\"user32.dll\")] public static extern void SwitchToThisWindow(IntPtr h, bool alt);",
      "[DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);'",
      'Add-Type -Namespace Wf -Name Fg -MemberDefinition $sig',
      '$h = [IntPtr]' + hwnd,
      '[Wf.Fg]::ShowWindow($h, 9) | Out-Null',
      '[Wf.Fg]::SwitchToThisWindow($h, $true)',
      '[Wf.Fg]::SetForegroundWindow($h) | Out-Null'
    ].join('; ');
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {});
  } catch (e) {}
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  try {
    mainWindow.show();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.moveTop();
    mainWindow.focus();
    mainWindow.flashFrame(true);
    mainWindow.once('focus', () => { try { mainWindow.flashFrame(false); } catch (e) {} });
    // Окно Windows показывает не сразу, поэтому пробуем переключиться несколько раз
    forceForeground(mainWindow);
    setTimeout(() => { try { forceForeground(mainWindow); } catch (e) {} }, 400);
    setTimeout(() => { try { forceForeground(mainWindow); } catch (e) {} }, 1100);
    clearTimeout(global.__topTimer);
    global.__topTimer = setTimeout(() => {
      try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); } catch (e) {}
    }, 2600);
  } catch (e) {
    try { mainWindow.show(); mainWindow.focus(); } catch (err) {}
  }
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

  // Масштаб интерфейса: колесо/ползунок в шапке меняет zoomFactor окна
  ipcMain.handle('ui-zoom', (e, f) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    // из окна масштаба всегда управляем главным окном, а не самим окном масштаба
    const target = (zoomWin && w === zoomWin) ? mainWindow : (w || mainWindow);
    if (!target) return 1;
    return applyUiZoom(target, f);
  });
  ipcMain.handle('ui-zoom-get', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    const target = (zoomWin && w === zoomWin) ? mainWindow : w;
    return target ? target.webContents.getZoomFactor() : 1;
  });
  ipcMain.handle('zoom-popup', (e, anchor) => { showZoomWindow(anchor); return true; });
  ipcMain.on('zoom-popup-close', () => { try { zoomHidden = true; if (zoomWin && !zoomWin.isDestroyed()) { zoomWin.destroy(); zoomWin = null; } } catch (e) {} });
  ipcMain.on('zoom-theme-sync', (e, theme) => {
    if (!theme) return;
    zoomTheme = theme;
    try {
      if (zoomWin && !zoomWin.isDestroyed()) {
        zoomWin.webContents.send('zoom-theme', theme);
        const key = zoomThemeKey(theme);
        // скрытое окно перезагружаем в новой теме — при открытии не будет вспышки
        if (zoomHidden && key !== zoomThemeKeyCur) {
          zoomThemeKeyCur = key;
          loadZoomPage(theme);
        }
      }
    } catch (e2) {}
  });
  ipcMain.handle('zoom-theme-get', () => zoomTheme);
  ipcMain.on('zoom-ready', () => { if (zoomPending) revealZoomWindow(); });

  const port = await startServer(Number(cfg('widgetPort')) || 0);
  log('панель для OBS: http://127.0.0.1:' + port + '/widget');
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
  // Виджет OBS: адрес страницы и поток состояния из окна приложения
// Пипетка: окно приложения просит цвет с любого места экрана
ipcMain.handle('pick-color', async () => {
  try { return await pickScreenColor(); } catch (e) { log('пипетка: ' + e.message); return null; }
});
ipcMain.handle('pick-init', () => pickSession || null);
ipcMain.handle('widget-url', () => (serverPort ? 'http://127.0.0.1:' + serverPort + '/widget' : ''));
ipcMain.on('widget-state', (e, st) => {
  if (st && typeof st === 'object') {
    widgetState = st;
    widgetBroadcast();
  }
});

ipcMain.handle('get-setting', (e, key) => { const v = readSettings()[key]; return v !== undefined ? v : DEFAULTS[key]; });
  ipcMain.handle('set-setting', (e, key, value) => {
    const s = readSettings(); s[key] = value;
    try { fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2)); } catch (err) { log('настройки: ошибка записи ' + err.message); }
    if (key === 'autoStart') applyAutoStart();
  if (key === 'widgetPort') { restartServer(Number(value) || 0); return true; }
    if (key === 'theme' || key === 'themeBar') applyThemeWindow();
    if (key === 'mediaKeys' || key === 'hotkeys') return applyHotkeys();
    if (key === 'npEnabled' || key === 'nowPlayingFormat' || key === 'npIdle' || key === 'nowPlayingPath') writeNowPlaying(lastNpInfo, true);
    return true;
  });
  // Перезапуск локального сервера на другом порту (нужно только для смены адреса панели)
async function restartServer(port) {
  try { if (httpServerRef) httpServerRef.close(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 250));
  const actual = await startServer(port);
  serverPort = actual;
  appUrl = 'http://127.0.0.1:' + actual + '/index.html';
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(appUrl);
  return actual;
}

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
  // Поиск одной песни по строке «Исполнитель — Название» (Плейлист из текста, импорт, перенос).
  // opts: { seconds — длительность-подсказка, only: 'ym'|'yt' — искать только там, noLocal }
  const MEM_MAX = 3000;
  const memKey = (line, only) => (only ? only + ':' : '') + match.norm(match.clean(line).query || line);
  function memGet(line, only) { const m = settingsStore.get('matchMemory') || {}; return m[memKey(line, only)] || null; }
  function memSet(line, only, track) {
    const m = settingsStore.get('matchMemory') || {};
    const k = memKey(line, only); if (!k) return;
    delete m[k]; m[k] = track;
    const keys = Object.keys(m); if (keys.length > MEM_MAX) keys.slice(0, keys.length - MEM_MAX).forEach((x) => delete m[x]);
    settingsStore.set('matchMemory', m);
  }
  async function matchOne(line, opts) {
    opts = opts || {};
    const q = match.clean(line);
    if (!q.query) return { status: 'skip' };
    const only = opts.only || '';
    const remembered = memGet(line, only);
    if (remembered && remembered.src && remembered.id && (!only || remembered.src === only)) return { query: q.query, status: 'exact', track: remembered, alts: [], remembered: true };
    // Свои файлы: если песня есть на компьютере — она и играет
    let local = null;
    if (!only && !opts.noLocal && cfg('preferLocal') !== false) { try { local = match.exactLocal(q, library.search(q.query, 6)); } catch (e) {} }
    if (local) return { query: q.query, status: 'exact', track: local, alts: [], local: true };
    let ymList = [], ytList = [];
    const getYt = async () => {
      try {
        const y = await ytsT(q.query, 8000);
        return (y.videos || []).slice(0, 6).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail }));
      } catch (err) { log('поиск песни: YouTube — ' + err.message); return []; }
    };
    if (only !== 'yt') { try { ymList = (await ym.searchTracksPage(q.query, 0, getYmToken())).slice(0, 6); } catch (err) { log('поиск песни: Яндекс — ' + err.message); } }
    let r;
    if (only === 'ym') r = match.decideOnly(q, ymList, 'ym');
    else if (only === 'yt') { ytList = await getYt(); r = match.decideOnly(q, ytList, 'yt'); }
    else {
      r = match.decide(q, ymList, []);
      if (r.status !== 'exact' && cfg('ytEnabled') !== false) { ytList = await getYt(); r = match.decide(q, ymList, ytList); }
    }
    r = match.preferDuration(r, opts.seconds || 0);
    return Object.assign({ query: q.query }, r);
  }
  ipcMain.handle('match-line', (e, line, opts) => matchOne(line, opts));
  ipcMain.handle('match-remember', (e, line, only, track) => { if (track && track.id) memSet(line, only || '', track); return true; });

  // --- Музыка с компьютера ---
  library.setup({ log, dataDir: app.getPath('userData') });
  const libSend = (ch, d) => { try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, d); } catch (e) {} };
  const libScan = () => library.scan((pr) => libSend('lib-progress', pr)).then((r) => { libSend('lib-changed', library.status()); return r; });
  setTimeout(() => { if (library.status().folders.length || library.status().extras) libScan().catch((e) => log('музыка с компьютера: ' + e.message)); }, 4000);

  // ===== Заказы со стрима: донаты → поиск песен в сообщении → вкладка «Заказы» =====
  const reqFile = () => path.join(app.getPath('userData'), 'requests.json');
  let requests = []; try { requests = JSON.parse(fs.readFileSync(reqFile(), 'utf8')) || []; } catch (e) { requests = []; }
  const saveReq = () => { try { requests = requests.slice(-300); fs.writeFileSync(reqFile(), JSON.stringify(requests)); } catch (e) { log('заказы: не сохранить ' + e.message); } };
  function reqRules() { const r = cfg('reqRules') || {}; return { maxSec: r.maxSec == null ? 420 : Number(r.maxSec) || 0, stopWords: Array.isArray(r.stopWords) ? r.stopWords : reqp.DEFAULT_STOP, explicitOk: !!r.explicitOk }; }
  async function reqSearch(q) {
    const out = [];
    if (cfg('preferLocal') !== false) { try { out.push.apply(out, library.search(q, 4)); } catch (e) {} }
    try { out.push.apply(out, (await ym.searchTracksPage(q, 0, getYmToken())).slice(0, 6)); } catch (e) { log('заказ: поиск в Яндексе — ' + e.message); }
    return out;
  }
  async function reqSearchYt(q) {
    try { const y = await ytsT(q, 8000); return (y.videos || []).slice(0, 5).map((v) => ({ src: 'yt', id: v.videoId, title: v.title, author: (v.author && v.author.name) || '', duration: (v.duration && v.duration.timestamp) || '', seconds: (v.duration && v.duration.seconds) || 0, thumb: v.thumbnail })); }
    catch (e) { return []; }
  }
  // Нормализация для сравнения слов в заказах: нижний регистр, ё→е, без знаков
  const rqNorm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  async function processDonation(d) {
    const p = reqp.plan(d.text);
    const items = [];
    for (const u of p.links.slice(0, 3)) {
      let r = null; try { r = await resolveLinkFn(u); } catch (e) {}
      const tr = r && r.tracks && r.tracks[0];
      if (tr) items.push({ level: 'exact', track: tr, alts: [], link: u });
      else items.push({ level: 'doubt', track: null, alts: [], link: u, note: /t\.me\//i.test(u) ? 'ссылка на Telegram — открой и найди песню сам' : 'ссылку не удалось открыть' });
    }
    const groups = {};
    p.queries.forEach((q) => { const g = q.kind === 'dash' ? 'c' + q.chunk : q.kind; (groups[g] = groups[g] || []).push(q); });
    for (const g of Object.keys(groups).slice(0, 3)) {
      const qs = groups[g], latin = qs[0].kind === 'latin', combo = qs[0].kind === 'combo';
      let best = null; const doubts = []; const seenK = new Set();
      let qWords = []; // слова текущего запроса — для проверки «все слова есть в песне»
      const covered = (t) => { const words = rqNorm((t.author || '') + ' ' + (t.title || '')).split(' ').filter(Boolean); return qWords.length > 0 && qWords.every((w) => words.indexOf(w) >= 0); };
      const consider = (list) => {
        for (const t of list) {
          const k = (t.src || '') + ':' + t.id; if (seenK.has(k)) continue; seenK.add(k);
          const j = reqp.judge(d.text, t);
          // слова без тире («кино печаль») засчитываем, только если в сообщении есть и название, и исполнитель,
          // и каждое слово запроса нашлось в самой песне — иначе «Выкати Исакова и Москву» станет музыкой
          if (j.level === 'exact' && (!combo || (j.a > 0 && covered(t)))) { if (!best) best = t; }
          else if (j.level === 'doubt' && !latin && !combo) doubts.push({ t, s: j.t * 2 + j.a });
        }
      };
      for (const q of qs.slice(0, combo ? 3 : 4)) { qWords = rqNorm(q.query).split(' ').filter(Boolean); consider(await reqSearch(q.query)); if (best) break; }
      if (!best && !latin && !combo && cfg('ytEnabled') !== false) consider(await reqSearchYt(qs[0].query));
      doubts.sort((a, b) => b.s - a.s);
      // сочетания слов без тире — всегда «под сомнением»: пусть стример посмотрит и решит
      if (best) items.push({ level: combo ? 'doubt' : 'exact', track: best, alts: doubts.slice(0, 3).map((x) => x.t), query: qs[0].query });
      else if (combo) { /* без тире и слов про музыку не нашлось — оставляем сообщение просто текстом */ }
      else if (doubts.length) items.push({ level: 'doubt', track: doubts[0].t, alts: doubts.slice(1, 3).map((x) => x.t), query: qs[0].query });
      else if (!latin && p.signal !== 'latin') items.push({ level: 'doubt', track: null, alts: [], query: qs[0].query, note: 'похоже на заказ, но песня не нашлась' });
    }
    const rules = reqRules();
    items.forEach((it) => { it.flags = it.track ? reqp.flags(it.track, d.text, rules) : []; });
    const price = Number(cfg('reqPrice')) || 0, cur = cfg('reqCurrency') || 'RUB';
    const amt = d.amountMain != null ? d.amountMain : (String(d.currency || '').toUpperCase() === cur ? d.amount : null);
    const paid = reqp.paidCount(amt, price);
    items.forEach((it, i) => { it.paid = i < paid; });
    const level = items.some((i) => i.level === 'exact') ? 'exact' : items.length ? 'doubt' : 'text';
    return Object.assign({}, d, { key: d.prov + ':' + d.id, items, level, signal: p.signal, amtMain: amt, paidN: paid === Infinity ? null : paid, state: 'new', got: Date.now() });
  }
  let reqChain = Promise.resolve();
  function onDonation(d) {
    reqChain = reqChain.then(async () => {
      let r;
      try { r = await processDonation(d); } catch (e) { log('заказы: ошибка разбора ' + e.message); r = Object.assign({}, d, { key: d.prov + ':' + d.id, items: [], level: 'text', state: 'new', got: Date.now() }); }
      if (requests.some((x) => x.key === r.key)) return;
      requests.push(r); saveReq();
      log('заказы: донат ' + (donations.NAMES[d.prov] || d.prov) + ' → ' + r.level + (r.items.length ? ' (' + r.items.map((i) => i.level + (i.track ? ' ' + i.track.author + ' — ' + i.track.title : '')).join('; ') + ')' : ''));
      libSend('req-new', r);
    });
    return reqChain;
  }
  donations.setup({ log, store: settingsStore, onDonation, onStatus: () => libSend('don-status', donations.status()) });
  donations.start();
  sitepage.setup({ log, store: settingsStore });
  ipcMain.handle('req-list', () => requests);
  ipcMain.handle('req-update', (e, key, patch) => { const r = requests.find((x) => x.key === key); if (r && patch) { Object.assign(r, patch); saveReq(); } return !!r; });
  ipcMain.handle('req-clear', () => { requests = requests.filter((x) => x.state === 'new' && x.level !== 'text'); saveReq(); return requests; });
  ipcMain.handle('req-test', async (e, text, amount) => { const d = { prov: 'test', id: 't' + Date.now(), name: 'Пробный заказ', text: String(text || ''), amount: Number(amount) || 0, currency: cfg('reqCurrency') || 'RUB', amountMain: Number(amount) || 0, at: Date.now() }; await onDonation(d); return requests.find((x) => x.key === 'test:' + d.id) || null; });
  ipcMain.handle('req-reparse', async (e, key) => { const i = requests.findIndex((x) => x.key === key); if (i < 0) return null; const r = await processDonation(requests[i]); r.state = requests[i].state; requests[i] = r; saveReq(); return r; });
  ipcMain.handle('req-remember', (e, line, track) => { if (track && track.id) memSet(line, '', track); return true; });
  ipcMain.handle('don-status', () => donations.status());
  ipcMain.handle('don-da-login', () => donations.daLogin());
  ipcMain.handle('don-da-cancel', () => { donations.daCancel(); return true; });
  ipcMain.handle('don-set-key', (e, p, key) => donations.setKey(p, key));
  ipcMain.handle('don-disconnect', (e, p) => donations.disconnect(p));
  ipcMain.handle('don-redirect', () => donations.DA_REDIRECT);
  // Сайт-визитка
  ipcMain.handle('site-status', () => sitepage.status());
  ipcMain.handle('site-preview', (e, p) => sitepage.build(p || {}));
  ipcMain.handle('site-publish', (e, p) => sitepage.publish(p || {}));
  ipcMain.handle('site-gh-token', (e, tok) => sitepage.setToken(tok));
  ipcMain.handle('site-gh-device-start', () => sitepage.deviceStart().catch((err) => ({ error: err.message })));
  ipcMain.handle('site-gh-device-wait', () => sitepage.deviceWait().catch((err) => ({ error: err.message })));
  ipcMain.handle('site-gh-device-cancel', () => { sitepage.deviceCancel(); return true; });
  ipcMain.handle('site-save', async (e, p) => {
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Сохранить страницу', defaultPath: 'index.html', filters: [{ name: 'Страница', extensions: ['html'] }] });
    if (r.canceled || !r.filePath) return { cancelled: true };
    fs.writeFileSync(r.filePath, sitepage.build(p || {}), 'utf8'); shell.showItemInFolder(r.filePath); return { ok: true, path: r.filePath };
  });
  // Ссылки для стримерской части: сервисы донатов, GitHub, своя страница
  ipcMain.handle('open-link', (e, url) => {
    const u = String(url || '');
    if (/^https:\/\/([a-z0-9-]+\.)*(donationalerts\.com|donatepay\.ru|donatepay\.eu|donatello\.to|yoomoney\.ru|boosty\.to|github\.com|github\.io|t\.me|twitch\.tv|youtube\.com|youtu\.be|vk\.com|vkvideo\.ru|kick\.com|music\.yandex\.ru|soundcloud\.com|developers\.sber\.ru)(\/|$)/i.test(u)) shell.openExternal(u);
    return true;
  });
  // Вкладка «Браузер»: назад / вперёд / обновить.
  // Делаем в главном процессе: у <webview> в Electron 33 методов canGoBack/goBack уже нет,
  // поэтому кнопки в окне молча ничего не делали.
  ipcMain.handle('br-nav', (e, id, action) => {
    try {
      const { webContents } = require('electron');
      const wc = webContents.fromId(Number(id));
      if (!wc) return { ok: false, error: 'окно браузера не найдено' };
      const nh = wc.navigationHistory;
      const canBack = nh ? nh.canGoBack() : (typeof wc.canGoBack === 'function' ? wc.canGoBack() : false);
      const canFwd = nh ? nh.canGoForward() : (typeof wc.canGoForward === 'function' ? wc.canGoForward() : false);
      if (action === 'back') { if (nh) nh.goBack(); else if (wc.canGoBack && wc.canGoBack()) wc.goBack(); }
      else if (action === 'forward') { if (nh) nh.goForward(); else if (wc.canGoForward && wc.canGoForward()) wc.goForward(); }
      else if (action === 'reload') wc.reload();
      return { ok: true, canBack, canFwd };
    } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
  });
  ipcMain.handle('lib-status', () => library.status());
  ipcMain.handle('lib-all', () => library.all());
  ipcMain.handle('lib-search', (e, q, n) => (cfg('libInSearch') === false ? [] : library.search(q, n || 30)));
  ipcMain.handle('lib-stream', (e, id) => (library.pathOf(id) ? { audioUrl: '/lfile/' + id } : { error: 'файл не найден на компьютере (переместили или удалили?)' }));
  ipcMain.handle('lib-add-folder', async (e, dir) => {
    if (!dir) {
      const r = await dialog.showOpenDialog(mainWindow, { title: 'Папка с музыкой', properties: ['openDirectory', 'multiSelections'] });
      if (r.canceled || !r.filePaths.length) return { cancelled: true };
      r.filePaths.forEach((d) => library.addFolder(d));
    } else library.addFolder(dir);
    const s0 = await libScan();
    return Object.assign({ ok: true }, s0, { status: library.status() });
  });
  ipcMain.handle('lib-remove-folder', (e, dir) => { library.removeFolder(dir); libSend('lib-changed', library.status()); return library.status(); });
  ipcMain.handle('lib-rescan', async () => { await libScan(); return library.status(); });
  ipcMain.handle('lib-reveal', (e, id) => { const f = library.pathOf(id); if (f) shell.showItemInFolder(f); return !!f; });
  ipcMain.handle('lib-open-files', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Музыка или плейлист', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Музыка и плейлисты', extensions: ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm', 'm3u', 'm3u8', 'pls'] }] });
    if (r.canceled) return { cancelled: true };
    return dropPaths(r.filePaths);
  });
  async function dropPaths(paths) {
    const c = await library.classify(paths || []);
    const tracks = await library.addFiles(c.audio);
    const playlists = [];
    for (const p0 of c.playlists) { try { playlists.push(await library.readPlaylistFile(p0)); } catch (err) { log('плейлист ' + path.basename(p0) + ': ' + err.message); } }
    return { tracks, folders: c.folders, playlists, other: c.other };
  }
  ipcMain.handle('lib-drop', (e, paths) => dropPaths(paths));
  ipcMain.handle('lib-folder-tracks', (e, dir) => library.folderTracks(dir));
  ipcMain.handle('m3u-export', async (e, title, tracks) => {
    const safe = String(title || 'Плейлист').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Плейлист';
    const r = await dialog.showSaveDialog(mainWindow, { title: 'Сохранить плейлист', defaultPath: path.join(app.getPath('music'), safe + '.m3u8'), filters: [{ name: 'Плейлист M3U', extensions: ['m3u8', 'm3u'] }] });
    if (r.canceled || !r.filePath) return { cancelled: true };
    try { fs.writeFileSync(r.filePath, '﻿' + library.m3uText(title, tracks), 'utf8'); log('плейлист сохранён в файл ' + path.basename(r.filePath)); return { ok: true, file: path.basename(r.filePath) }; }
    catch (err) { return { error: err.message }; }
  });

  // --- Мастер «Импорт»: откуда взять список песен ---
  const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', 'Accept-Language': 'ru,en;q=0.8' };
  async function fetchText(u, ms) { const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(ms || 15000) }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
  async function importFile(f) {
    const ext = path.extname(f).toLowerCase();
    if (library.isPlaylistFile(f)) { const pl = await library.readPlaylistFile(f); return { title: pl.title, source: 'm3u', items: pl.items.map((x) => ({ line: x.line, seconds: x.seconds, url: x.track ? '' : x.url, track: x.track || null })) }; }
    const buf = fs.readFileSync(f);
    let text = buf.toString('utf8');
    if (text.includes('�')) { try { text = new TextDecoder('windows-1251').decode(buf); } catch (e) {} }
    let r = null, source = 'text';
    if (ext === '.json') { r = importers.fromTelegramJson(text); source = 'telegram'; }
    else if (ext === '.html' || ext === '.htm') { r = importers.fromTelegramHtml(text); source = 'telegram'; }
    else if (ext === '.csv' || ext === '.tsv') { r = importers.fromCsv(text); source = 'csv'; }
    if (!r) { r = importers.fromText(text); source = 'text'; }
    return { title: r.title || path.basename(f, ext), source, items: r.items };
  }
  ipcMain.handle('import-file', async (e, f) => {
    let files0 = f ? [f] : null;
    if (!files0) {
      const d = await dialog.showOpenDialog(mainWindow, { title: 'Файл со списком песен', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Списки песен', extensions: ['json', 'html', 'htm', 'csv', 'tsv', 'txt', 'm3u', 'm3u8', 'pls'] }, { name: 'Все файлы', extensions: ['*'] }] });
      if (d.canceled || !d.filePaths.length) return { cancelled: true };
      files0 = d.filePaths;
    }
    const out = { title: '', source: '', items: [] };
    for (const x of files0) {
      try { const r = await importFile(x); out.title = out.title || r.title; out.source = out.source || r.source; out.items = out.items.concat(r.items); }
      catch (err) { log('импорт файла ' + path.basename(x) + ': ' + err.message); out.error = 'не удалось прочитать «' + path.basename(x) + '»'; }
    }
    out.items = importers.dedupeItems(out.items);
    log('импорт: файл, строк ' + out.items.length + ' (' + out.source + ')');
    return out;
  });
  ipcMain.handle('import-url', async (e, raw, opts) => {
    opts = opts || {};
    const t = String(raw || '').trim();
    let u; try { u = new URL(/^https?:\/\//i.test(t) ? t : 'https://' + t); } catch (err) { return { error: 'это не ссылка' }; }
    const host = u.hostname.replace(/^www\.|^m\./, '').toLowerCase(), p = u.pathname;
    try {
      // Видео YouTube: главы и описание (список песен в длинных видео и миксах)
      if (/^(youtube\.com|music\.youtube\.com|youtu\.be)$/.test(host)) {
        const vid = host === 'youtu.be' ? p.slice(1).split('/')[0] : (u.searchParams.get('v') || ((/^\/(shorts|live|embed)\/([\w-]{6,})/.exec(p) || [])[2]));
        const list = u.searchParams.get('list');
        if (vid && !(list && opts.preferList)) {
          const j = await ydlJson(['https://www.youtube.com/watch?v=' + vid, '--no-playlist', '--skip-download', ...ytCookieArgs(false)], 60000);
          if (j.error) return { error: 'YouTube: ' + j.error };
          const r = importers.fromYoutubeInfo(j);
          const self = { src: 'yt', id: vid, title: j.title || '', author: j.channel || j.uploader || '', seconds: j.duration || 0, duration: fmtDur(j.duration), thumb: 'https://i.ytimg.com/vi/' + vid + '/mqdefault.jpg' };
          log('импорт: видео YouTube, ' + r.kind + ', строк ' + r.items.length);
          return { title: r.title, source: 'youtube-' + r.kind, items: r.items, video: self, hasList: !!list, note: r.note };
        }
      }
      // Ссылки площадок, которые Тапёр открывает сам: треки уже найдены
      if (/^music\.yandex\./.test(host) || /^(youtube\.com|music\.youtube\.com|youtu\.be|soundcloud\.com|on\.soundcloud\.com)$/.test(host) || /(^|\.)bandcamp\.com$/.test(host)) {
        const r = await resolveLinkFn(u.toString());
        if (!r || r.error) return { error: (r && r.error) || 'не понял ссылку' };
        const L = r.list || { title: (r.tracks && r.tracks[0] && r.tracks[0].title) || 'По ссылке', tracks: r.tracks || [] };
        return { title: L.title, source: 'platform', items: (L.tracks || []).map((tr) => ({ line: (tr.author ? tr.author + ' — ' : '') + tr.title, seconds: tr.seconds || 0, track: tr })) };
      }
      if (host === 'open.spotify.com') {
        const m = /\/(playlist|album|track)\/([A-Za-z0-9]+)/.exec(p);
        if (!m) return { error: 'такую ссылку Spotify не понимаю' };
        const r = importers.fromSpotifyEmbed(await fetchText('https://open.spotify.com/embed/' + m[1] + '/' + m[2]));
        if (!r || !r.items.length) return { error: 'Spotify не отдал список — скопируй названия текстом' };
        log('импорт: Spotify ' + m[1] + ', строк ' + r.items.length);
        return { title: r.title, source: 'spotify', items: r.items, note: r.items.length >= 100 && m[1] === 'playlist' ? 'Spotify показывает без входа только первые 100 песен — для больших плейлистов лучше выгрузка CSV (Exportify).' : '' };
      }
      if (/^deezer\.com$/.test(host) || host === 'deezer.page.link' || host === 'link.deezer.com') {
        let m = /\/(playlist|album)\/(\d+)/.exec(p);
        if (!m) { try { const r0 = await fetch(u.toString(), { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(12000) }); m = /\/(playlist|album)\/(\d+)/.exec(r0.url); } catch (err) {} }
        if (!m) return { error: 'такую ссылку Deezer не понимаю' };
        const j = await (await fetch('https://api.deezer.com/' + m[1] + '/' + m[2] + '?limit=2000', { signal: AbortSignal.timeout(15000) })).json();
        if (j.error) return { error: 'Deezer: ' + (j.error.message || 'ошибка') };
        const r = importers.fromDeezerJson(j);
        return { title: r.title, source: 'deezer', items: r.items };
      }
      if (host === 'music.apple.com') {
        const r = importers.fromAppleHtml(await fetchText(u.toString()));
        if (!r.items.length) return { error: 'Apple Music не отдал список — скопируй названия текстом' };
        return { title: r.title, source: 'apple', items: r.items };
      }
      if (host === 't.me' || host === 'telegram.me') {
        const parts = p.split('/').filter(Boolean);
        if (!parts.length || /^(\+|joinchat)/.test(parts[0])) return { error: 'это закрытый чат — сделай «Экспорт истории» в Telegram Desktop и выбери файл' };
        const chan = parts[0] === 's' ? parts[1] : parts[0];
        let before = 0, items = [], title = '';
        const pages = Math.max(1, Math.min(30, opts.pages || 8));
        for (let k = 0; k < pages; k++) {
          const html = await fetchText('https://t.me/s/' + encodeURIComponent(chan) + (before ? '?before=' + before : ''));
          const r = importers.fromTmeChannel(html);
          title = title || r.title; items = items.concat(r.items);
          if (!r.oldest || r.oldest <= 1 || r.oldest === before) break;
          before = r.oldest;
        }
        if (!items.length) return { error: 'в открытой части канала не нашлось песен (закрытый канал? — тогда «Экспорт истории» в Telegram Desktop)' };
        log('импорт: канал Telegram ' + chan + ', строк ' + items.length);
        return { title, source: 'telegram', items: importers.dedupeItems(items) };
      }
      if (/^(vk\.com|vk\.ru|m\.vk\.com)$/.test(host)) return { error: 'ВКонтакте не даёт программам свою музыку. Открой страницу с аудио во вкладке «Браузер» и нажми «Собрать песни»', vk: true };
      return { error: 'с этого сайта пока не умею — скопируй список текстом' };
    } catch (err) { log('импорт по ссылке: ' + err.message); return { error: err.message }; }
  });

  // --- Свои плейлисты на площадках: Яндекс ---
  const ymNeed = async () => { const tok = getYmToken(); if (!tok) throw new Error('нет входа в Яндекс'); return { tok, uid: await ymUidGet() }; };
  const ymWrap = (name, fn) => async (...a) => { try { return Object.assign({ ok: true }, await fn(...a)); } catch (err) { log('Яндекс: ' + name + ' — ' + err.message); return { error: err.message }; } };
  ipcMain.handle('ym-pl-rename', ymWrap('переименование плейлиста', async (e, kind, title) => { const { tok, uid } = await ymNeed(); await ym.renamePlaylist(tok, uid, kind, title); log('Яндекс: плейлист переименован'); return {}; }));
  ipcMain.handle('ym-pl-delete', ymWrap('удаление плейлиста', async (e, kind) => { const { tok, uid } = await ymNeed(); await ym.deletePlaylist(tok, uid, kind); log('Яндекс: плейлист удалён'); return {}; }));
  ipcMain.handle('ym-pl-remove', ymWrap('удаление треков', async (e, kind, ids) => { const { tok, uid } = await ymNeed(); return ym.removeTracks(tok, uid, kind, ids); }));
  ipcMain.handle('ym-pl-add', ymWrap('добавление треков', async (e, kind, tracks) => { const { tok, uid } = await ymNeed(); return ym.appendTracks(tok, uid, kind, tracks || []); }));
  ipcMain.handle('ym-pl-create', ymWrap('создание плейлиста', async (e, title, tracks) => {
    const { tok, uid } = await ymNeed();
    const pl = await ym.createPlaylist(tok, uid, String(title || 'Плейлист из Тапёра').slice(0, 100));
    const r = (tracks && tracks.length) ? await ym.addToPlaylist(tok, uid, pl.kind, pl.revision, tracks) : { count: 0 };
    log('Яндекс: создан плейлист, треков ' + r.count);
    return { uid, kind: String(pl.kind), count: r.count };
  }));
  // Содержимое для синхронизации: id треков на площадке
  ipcMain.handle('pl-remote', async (e, target, link) => {
    try {
      if (target === 'ym') { const { tok, uid } = await ymNeed(); const i = await ym.playlistInfo(tok, link.uid || uid, link.kind); return { ok: true, ids: i.items.map((x) => x.id), title: i.title }; }
      if (target === 'yt') { const items = await ytoauth.playlistItems(link.listId); return { ok: true, items }; }
    } catch (err) { log('синхронизация: ' + err.message); return { error: err.message, gone: /404|not ?found|playlistNotFound/i.test(err.message) }; }
    return { error: 'нет такой площадки' };
  });
  // --- YouTube (официальный API, вход через браузер с разрешением на изменения) ---
  const ytWrap = (name, fn) => async (...a) => {
    if (!ytoauth.loggedIn()) return { error: 'нужен вход в YouTube через браузер', needLogin: true };
    if (!ytoauth.canWrite()) return { error: 'нужен повторный вход в YouTube — разрешить Тапёру менять плейлисты', needLogin: true };
    try { return Object.assign({ ok: true }, await fn(...a)); } catch (err) { log('YouTube API: ' + name + ' — ' + err.message); return { error: err.message, added: err.added, needLogin: /повторный вход/.test(err.message), quota: err.reason === 'quotaExceeded' }; }
  };
  ipcMain.handle('yt-pl-create', ytWrap('создание плейлиста', async (e, title, ids) => {
    const pl = await ytoauth.createPlaylist(title);
    let n = 0;
    try { n = (await ytoauth.addVideos(pl.listId, ids || [], (k) => libSend('push-progress', { done: k, total: (ids || []).length }))).count; }
    catch (err) { err.listId = pl.listId; return { listId: pl.listId, count: err.added || 0, partial: true, error: err.message, quota: err.reason === 'quotaExceeded' }; }
    log('YouTube API: создан плейлист, видео ' + n);
    return { listId: pl.listId, count: n };
  }));
  ipcMain.handle('yt-pl-add', ytWrap('добавление видео', async (e, listId, ids) => {
    try { return await ytoauth.addVideos(listId, ids || [], (k) => libSend('push-progress', { done: k, total: (ids || []).length })); }
    catch (err) { return { count: err.added || 0, partial: true, error: err.message, quota: err.reason === 'quotaExceeded' }; }
  }));
  ipcMain.handle('yt-pl-rename', ytWrap('переименование', async (e, listId, title) => { await ytoauth.renamePlaylist(listId, title); return {}; }));
  ipcMain.handle('yt-pl-delete', ytWrap('удаление', async (e, listId) => { await ytoauth.deletePlaylist(listId); return {}; }));
  ipcMain.handle('yt-pl-remove', ytWrap('удаление видео', async (e, listId, videoIds) => {
    const want = new Set(videoIds || []);
    const items = (await ytoauth.playlistItems(listId)).filter((x) => want.has(x.videoId));
    return ytoauth.removeItems(items.map((x) => x.itemId));
  }));
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
  ipcMain.handle('resolve-link', (e, text) => resolveLinkFn(text));
  async function resolveLinkFn(text) {
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
  }
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
    oauth: { configured: ytoauth.configured(), account: ytoauth.loggedIn() ? (settingsStore.get('ytOauthAccount') || { name: 'аккаунт Google' }) : null, canWrite: ytoauth.canWrite() },
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
      if (!fs.existsSync(bin)) { resolve({ error: 'движок YouTube не найден' }); return; }
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
    steps.push(step('Движок YouTube', !!ver, ver ? 'версия ' + ver + (up.updated ? ' — только что обновлена' : (up.ok ? ', свежая' : ', обновить не удалось')) : 'не найдена', up.ok ? '' : up.text));
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
    if (ok) { const s2 = await urlStream(r[0].id); st = !!(s2 && s2.audioUrl); steps.push(step('Воспроизведение', st, st ? 'работает' : 'не работает', s2 && s2.error ? s2.error : '')); }
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
      // Отчёты: сломанные шаги глубокой проверки (кроме «нет сети / нужен VPN»)
      const SLUG = { 'Поиск': 'search', 'Воспроизведение': 'stream', 'Запасной': 'site', 'Движок': 'ytdlp' };
      for (const [name, sv] of Object.entries(res.services)) {
        (sv.steps || []).filter((st) => st.ok === false && !/VPN|не отвечает/i.test(st.text || '')).forEach((st) => {
          const stage = (Object.keys(SLUG).find((k) => st.name.indexOf(k) === 0) && SLUG[Object.keys(SLUG).find((k) => st.name.indexOf(k) === 0)]) || 'check';
          sendReport({ service: name, stage, code: String(st.details || st.text || '').split(/[:\n]/)[0].slice(0, 40) || 'fail', msg: st.name + ': ' + (st.text || ''), details: st.details || '' });
        });
      }
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
  // ===== Быстрая проверка при запуске: всё параллельно, по 6 секунд на пункт, без воспроизведения =====
  // Каждый пункт сразу сообщается окну (qc-item), чтобы лампочки загорались по очереди.
  const QC_T = 6000;
  async function ping(url, opts) {
    const t0 = Date.now();
    const { net: enet } = require('electron');
    const r = await enet.fetch(url, Object.assign({ method: 'GET', signal: AbortSignal.timeout(QC_T), redirect: 'follow' }, opts || {}));
    try { r.body && r.body.cancel && r.body.cancel(); } catch (e) {}
    return { status: r.status, ms: Date.now() - t0 };
  }
  const verOlder = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0; } return false; };
  const ytdlpAgeDays = (v) => { const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(v || ''); return m ? Math.round((Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000) : null; };
  let qcRunning = null;
  async function quickCheck(send) {
    if (qcRunning) return qcRunning;
    qcRunning = (async () => {
      const out = {};
      const put = (id, state, text, extra) => { out[id] = Object.assign({ id, state, text }, extra || {}); try { send && send(out[id]); } catch (e) {} };
      const t0 = Date.now();
      const job = async (id, fn) => { put(id, 'run', 'проверяю…'); try { await fn(); } catch (e) { put(id, 'bad', 'ошибка проверки', { details: String(e.message || e).slice(0, 300) }); } };
      // Интернет — от него зависит всё остальное
      let online = false;
      await job('net', async () => {
        for (const u of ['https://ya.ru/', 'https://www.google.com/generate_204']) { try { const r = await ping(u); online = true; put('net', 'ok', 'есть · ' + r.ms + ' мс'); return; } catch (e) {} }
        put('net', 'bad', 'нет связи', { action: 'retry' });
      });
      if (!online) {
        ['app', 'recipes', 'ym.svc', 'ym.acc', 'ym.play', 'ym.site', 'yt.svc', 'yt.login', 'yt.dlp', 'sc', 'refs', 'tg', 'don'].forEach((id) => put(id, 'off', 'нет интернета'));
      } else {
        await Promise.all([
          job('app', async () => {
            const u = updateState || {};
            if (u.state === 'available' || u.state === 'downloading' || u.state === 'ready') put('app', 'warn', 'вышла ' + (u.version || 'новая версия'), { action: 'update' });
            else put('app', 'ok', app.getVersion() + (u.state === 'latest' ? ' · последняя' : ''));
          }),
          job('recipes', async () => { const r = await recipes.refresh(); const i = recipes.info(); put('recipes', r.ok ? 'ok' : 'warn', 'v' + i.version + (r.ok ? ' · свежие' : ' · GitHub недоступен, работаю на сохранённых')); }),
          job('ym.svc', async () => { const r = await ping('https://api.music.yandex.net/genres'); put('ym.svc', r.status < 500 ? 'ok' : 'bad', r.status < 500 ? 'доступен · ' + r.ms + ' мс' : 'ошибка ' + r.status, r.status < 500 ? {} : { report: { stage: 'service', code: 'HTTP ' + r.status } }); }),
          job('ym.acc', async () => {
            const st = await ymStatus();
            if (!st.loggedIn) put('ym.acc', st.error ? 'bad' : 'off', st.error || 'нет входа', { action: 'ym-login' });
            else put('ym.acc', st.offline ? 'warn' : (st.hasPlus ? 'ok' : 'warn'), (st.name || 'вход есть') + (st.offline ? ' · не проверить' : (st.hasPlus ? ' · Плюс' : ' · без Плюса — отрывки')));
            const tok = getYmToken(), tr = settingsStore.get('healthYmTrack');
            if (!tok) { put('ym.play', 'off', 'нужен вход'); return; }
            if (!tr) { put('ym.play', 'off', 'проверится при глубокой проверке'); return; }
            try { const s2 = await ym.streamUrl(tr.id, tok); const ok = !!(s2 && s2.audioUrl); put('ym.play', ok ? (s2.preview ? 'warn' : 'ok') : 'bad', ok ? (s2.preview ? 'только отрывки' : 'поток получен') : 'поток не получен', ok ? {} : { report: { stage: 'stream', code: 'no-url' } }); }
            catch (e) { put('ym.play', 'bad', 'не работает', { details: e.message, report: { stage: 'stream', code: String(e.status || e.message).slice(0, 40) } }); }
          }),
          job('ym.site', async () => {
            if (!cfg('ymWebFallback')) { put('ym.site', 'off', 'выключен в настройках'); return; }
            const h = settingsStore.get('health'), y = h && h.services && h.services.yandex;
            const st = y && (y.steps || []).find((x) => /сайт/i.test(x.name));
            if (!st || st.ok == null) put('ym.site', 'off', 'проверяется раз в сутки');
            else put('ym.site', st.ok ? 'ok' : 'bad', st.ok ? 'кнопка найдена' : 'сайт изменился', st.ok ? {} : { action: 'fix', report: { stage: 'site', code: 'button' }, details: st.text });
          }),
          job('yt.svc', async () => {
            if (cfg('ytEnabled') === false) { put('yt.svc', 'off', 'выключен в настройках'); return; }
            try { const r = await ping('https://www.youtube.com/generate_204'); put('yt.svc', r.status < 500 ? 'ok' : 'bad', 'доступен · ' + r.ms + ' мс'); }
            catch (e) { put('yt.svc', 'bad', 'не отвечает', { action: 'vpn' }); }
          }),
          job('yt.login', async () => {
            const a = ytAuthStatus();
            const who = (a.cookies && a.cookies.name) || (a.oauth && a.oauth.account && a.oauth.account.name);
            put('yt.login', who ? 'ok' : 'off', who ? who : 'нет входа', who ? {} : { action: 'yt-login' });
          }),
          job('yt.dlp', async () => {
            // «Устарел» — только если вышла версия новее (по GitHub); старая дата сама по себе не проблема
            const v = await ytdlpVersion(ytdlpPath());
            if (!v) { put('yt.dlp', 'bad', 'не найден', { action: 'fix', report: { stage: 'ytdlp', code: 'missing' } }); return; }
            let latest = '';
            try {
              const { net: enet } = require('electron');
              const r = await enet.fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tapyor' }, signal: AbortSignal.timeout(QC_T) });
              if (r.ok) latest = String((await r.json()).tag_name || '').replace(/^v/, '');
            } catch (e) {}
            const older = latest && verOlder(v, latest);
            put('yt.dlp', older ? 'warn' : 'ok', 'версия ' + v + (older ? ' · есть новее' : (latest ? ' · последняя' : '')), older ? { action: 'fix' } : {});
          }),
          job('sc', async () => {
            const res = await Promise.allSettled([ping('https://soundcloud.com/'), ping('https://api.audius.co/v1/tracks/trending?limit=1&app_name=' + AU_APP)]);
            const okN = res.filter((x) => x.status === 'fulfilled' && x.value.status < 500).length;
            put('sc', okN === 2 ? 'ok' : (okN ? 'warn' : 'bad'), okN === 2 ? 'доступны' : (okN ? (res[0].status === 'fulfilled' ? 'Audius не отвечает' : 'SoundCloud не отвечает') : 'не отвечают'));
          }),
          job('refs', async () => {
            const res = await Promise.allSettled([ping('https://api.deezer.com/genre'), lastfm.configured() ? ping('https://ws.audioscrobbler.com/2.0/') : Promise.reject(new Error('нет ключа'))]);
            const dz = res[0].status === 'fulfilled', lf = res[1].status === 'fulfilled';
            put('refs', dz && lf ? 'ok' : (dz || lf ? 'warn' : 'bad'), dz && lf ? 'доступны' : (dz ? (lastfm.configured() ? 'Last.fm не отвечает' : 'Last.fm без ключа') : (lf ? 'Deezer не отвечает' : 'не отвечают')));
          }),
          job('don', async () => {
            const st = donations.status(); const on = Object.keys(st).filter((k) => st[k].connected);
            if (!on.length) { put('don', 'off', 'не подключены'); return; }
            const r = await donations.check(); const bad = on.filter((k) => !(r[k] && (r[k].ok || r[k].pending)));
            const pend = on.filter((k) => r[k] && r[k].pending);
            put('don', bad.length ? (bad.length === on.length ? 'bad' : 'warn') : 'ok',
              bad.length ? bad.map((k) => st[k].name + ': ' + ((r[k] && r[k].error) || 'нет связи')).join(' · ')
                : pend.length === on.length ? on.map((k) => st[k].name).join(' · ') + ' — первый опрос идёт'
                : on.map((k) => st[k].name).join(' · ') + ' на связи');
          }),
          job('tg', async () => { try { const r = await ping('https://web.telegram.org/a/'); put('tg', r.status < 500 ? 'ok' : 'warn', 'сайт доступен'); } catch (e) { put('tg', 'warn', 'сайт не отвечает'); } })
        ]);
      }
      const res = { at: Date.now(), ms: Date.now() - t0, items: out };
      settingsStore.set('quickCheck', res);
      const bad = Object.values(out).filter((x) => x.state === 'bad' || x.state === 'warn').map((x) => x.id + ':' + x.text);
      log('быстрая проверка: ' + Math.round(res.ms / 100) / 10 + ' с' + (bad.length ? ' · внимание: ' + bad.join('; ') : ' · всё работает'));
      // Отчёты об ошибках сервисов (не «нет входа» и не «нет интернета»)
      Object.values(out).forEach((x) => { if (x.report && x.state === 'bad') sendReport({ service: x.id.split('.')[0], stage: x.report.stage, code: x.report.code, msg: x.text, details: x.details || '' }); });
      return res;
    })();
    try { return await qcRunning; } finally { qcRunning = null; }
  }
  ipcMain.handle('qc-run', (e) => quickCheck((it) => { try { e.sender.send('qc-item', it); } catch (x) {} }));
  ipcMain.handle('qc-get', () => settingsStore.get('quickCheck') || null);

  // ===== Автопочинка: по шагам, с отчётом что сделано =====
  ipcMain.handle('auto-fix', async (e) => {
    const done = [];
    const say = (t, ok) => { done.push({ t, ok }); try { e.sender.send('fix-step', { t, ok }); } catch (x) {} log('автопочинка: ' + (ok ? '✓ ' : '✗ ') + t); };
    const r1 = await recipes.refresh(); say(r1.ok ? 'Рецепты сайтов обновлены до v' + recipes.info().version : 'Свежие рецепты скачать не удалось — GitHub недоступен', r1.ok);
    const r2 = await ytdlpUpdate(); say(r2.updated ? 'Движок YouTube обновлён' + (r2.version ? ' до ' + r2.version : '') : (r2.ok ? 'Движок YouTube уже свежий' : 'Движок YouTube обновить не удалось'), r2.ok);
    const ys = await ymStatus(); say(ys.loggedIn ? 'Вход в Яндекс в порядке' + (ys.offline ? ' (не проверить — Яндекс не отвечает)' : '') : 'Нужно войти в Яндекс заново', ys.loggedIn);
    { const a = ytAuthStatus(); const who = (a.cookies && a.cookies.name) || (a.oauth && a.oauth.account && a.oauth.account.name); say(who ? 'Вход в YouTube есть: ' + who : 'Вход в YouTube не настроен (не обязателен)', true); }
    try {
      const { session } = require('electron');
      await session.defaultSession.clearCache(); await session.fromPartition('persist:yandex-login').clearCache();
      say('Временные файлы площадок очищены (входы не тронуты)', true);
    } catch (x) { say('Очистить временные файлы не удалось', false); }
    const q = await quickCheck((it) => { try { e.sender.send('qc-item', it); } catch (x) {} });
    const left = Object.values(q.items).filter((x) => x.state === 'bad').length;
    say(left ? 'Осталось проблем: ' + left + ' — отчёт отправлен разработчику' : 'Проверка заново: всё работает', !left);
    return { done, left };
  });

  ipcMain.handle('report-test', () => sendReport({ service: 'test', stage: 'setup', code: 'check', msg: 'Проверка связи из Тапёра', details: '' }, true));
  ipcMain.handle('report-preview', () => lastReport || { пример: 'отчёта ещё не было', поля: 'площадка, этап, код ошибки, текст без личного, версия Тапёра и рецептов, Windows, случайный номер установки' });
  ipcMain.handle('report-send', (e, r) => sendReport(r || {}));
  // Палитры из The Color API (https, без ключа): режимы monochrome, monochrome-dark, monochrome-light, analogic, complement, analogic-complement, triad, quad
  ipcMain.handle('palette-api', async (e, hex, mode) => {
    try {
      const h = String(hex || '').replace('#', ''); if (!/^[0-9a-f]{6}$/i.test(h)) return { error: 'цвет' };
      const m = /^(monochrome|monochrome-dark|monochrome-light|analogic|complement|analogic-complement|triad|quad)$/.test(mode) ? mode : 'analogic';
      const { net: enet } = require('electron');
      const r = await enet.fetch('https://www.thecolorapi.com/scheme?format=json&count=5&hex=' + h + '&mode=' + m, { signal: AbortSignal.timeout(8000) });
      const j = await r.json();
      return { colors: ((j && j.colors) || []).map((c) => c && c.hex && c.hex.value).filter(Boolean) };
    } catch (err) { log('палитры: The Color API — ' + err.message); return { error: err.message }; }
  });
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
