// Запасной способ для Яндекс Музыки: официальный сайт music.yandex.ru в скрытом окне.
// Сайт сам играет трек со входом пользователя, а Тапёр нажимает «Слушать» и управляет звуком страницы.
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const recipes = require('./recipes');

const PARTITION = 'persist:yandex-login'; // те же cookies, что после входа через окно Яндекса
let win = null;
let log = () => {};
let toRenderer = () => {};
let lastState = null;
let replySeq = 0;
const replies = new Map();
let wired = false;

function setup(opts) {
  log = opts.log || log;
  toRenderer = opts.send || toRenderer;
  if (wired) return;
  wired = true;
  ipcMain.on('ymweb-state', (e, d) => { if (win && e.sender === win.webContents) { lastState = d; toRenderer('ymweb-state', d); } });
  ipcMain.on('ymweb-reply', (e, id, d) => { const r = replies.get(id); if (r) { replies.delete(id); r(d); } });
}

function ensureWin() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    show: false, width: 1280, height: 860, title: 'Яндекс Музыка (Тапёр)',
    autoHideMenuBar: true, backgroundColor: '#ffffff',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'ymweb-preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, // в фоне не засыпать — иначе звук будет запинаться
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('close', (e) => { if (!win.__quitting) { e.preventDefault(); win.hide(); } });
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (e, d) => { log('Яндекс (сайт): страница упала — ' + (d && d.reason)); toRenderer('ymweb-state', { ev: 'error', error: 'страница Яндекса закрылась' }); });
  return win;
}

function cmd(name, value, timeoutMs) {
  return new Promise((resolve) => {
    if (!win || win.isDestroyed()) { resolve({ ok: false, error: 'окно не открыто' }); return; }
    const id = ++replySeq;
    const t = setTimeout(() => { if (replies.has(id)) { replies.delete(id); resolve({ ok: false, error: 'нет ответа' }); } }, timeoutMs || 5000);
    replies.set(id, (d) => { clearTimeout(t); resolve(d || { ok: false }); });
    win.webContents.send('ymweb-cmd', name, value, id);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
let playToken = 0;

// Включить трек на сайте. Возвращает { ok } или { error, stage, details } — этап, на котором сломалось:
// open — сайт не открылся, button — не нашлась кнопка «Слушать», sound — звук не пошёл,
// match — заиграл другой трек, preview — только отрывок (нет входа/подписки на сайте)
async function play(t, volume) {
  const token = ++playToken;
  const w = ensureWin();
  const R = (recipes.get().yandex) || {};
  if (!t || !t.id) return { error: 'нет трека', stage: 'open' };
  const url = (t.albumId ? (R.trackUrl || 'https://music.yandex.ru/album/{albumId}/track/{id}') : (R.trackUrlNoAlbum || 'https://music.yandex.ru/track/{id}'))
    .replace('{albumId}', encodeURIComponent(t.albumId || '')).replace('{id}', encodeURIComponent(t.id));
  log('Яндекс (сайт): открываю ' + url);
  await cmd('hold', null, 2000);
  lastState = null;
  try {
    await w.loadURL(url);
  } catch (e) {
    log('Яндекс (сайт): страница не открылась — ' + e.message);
    return { error: 'сайт Яндекс Музыки не открылся', stage: 'open', details: e.message };
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  await cmd('volume', volume == null ? 1 : volume, 2000);
  // Сайт дорисовывается скриптами — ищем кнопку «Слушать» до 15 секунд
  let clicked = null, seen = null;
  for (let k = 0; k < 30 && token === playToken; k++) {
    const r = await cmd('start', R.play || {}, 3000);
    if (r && r.ok) { clicked = r; break; }
    if (r && r.seen) seen = r.seen;
    await sleep(500);
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  if (!clicked) {
    log('Яндекс (сайт): не нашёл кнопку «Слушать». Кнопки на странице: ' + JSON.stringify(seen || []).slice(0, 900));
    return { error: 'на сайте Яндекса не нашлась кнопка «Слушать» — похоже, сайт изменился', stage: 'button', details: 'кнопки на странице: ' + (seen || []).join(' | ') };
  }
  log('Яндекс (сайт): нажал «' + clicked.clicked + '»' + (clicked.others && clicked.others.length ? ' (ещё были: ' + clicked.others.join(' | ') + ')' : ''));
  // Ждём, что звук пошёл
  for (let k = 0; k < 40 && token === playToken; k++) {
    if (lastState && !lastState.paused && lastState.time > 0.2) break;
    await sleep(250);
  }
  if (token !== playToken) return { error: 'отменено', stage: 'cancel' };
  const info = await cmd('info', R.loggedInSelector || null, 2000);
  const det = 'нажата кнопка: «' + clicked.clicked + '»; страница: ' + (info && info.url || url);
  if (!lastState || lastState.paused) {
    log('Яндекс (сайт): звук не пошёл. Страница: ' + JSON.stringify(info).slice(0, 400));
    await cmd('hold', null, 2000);
    const noLogin = info && info.loggedIn === false;
    return { error: noLogin ? 'сайт Яндекса не начал играть — похоже, нет входа на сайте' : 'кнопка нажалась, но сайт Яндекса не начал играть — похоже, сайт изменился', stage: noLogin ? 'login' : 'sound', details: det };
  }
  // Проверяем, что играет именно наш трек (по названию в системной карточке «сейчас играет»)
  const got = norm(info && info.title), want = norm(t.title);
  if (got && want && !(got.includes(want.slice(0, 12)) || want.includes(got.slice(0, 12)))) {
    log('Яндекс (сайт): заиграло не то — «' + (info.artist || '') + ' — ' + info.title + '» вместо «' + t.title + '»');
    await cmd('hold', null, 2000);
    return { error: 'сайт включил другой трек («' + info.title + '») — похоже, Тапёр нажал не ту кнопку', stage: 'match', details: det };
  }
  const dur = lastState.dur || 0;
  if (t.seconds > 60 && dur > 0 && dur < 35) {
    log('Яндекс (сайт): только отрывок 30 с — нет входа или подписки на сайте');
    await cmd('hold', null, 2000);
    return { error: 'сайт даёт только отрывок 30 секунд — нужен вход на сайте и подписка Плюс', stage: 'login', details: det };
  }
  log('Яндекс (сайт): играет «' + (info.title || t.title) + '», длина ' + Math.round(dur) + ' с');
  return { ok: true, dur, details: det };
}

function stop() { playToken++; return cmd('hold', null, 2000); }

// Показать окно входа на сайте (для тех, кто входил через браузер — у окна сайта своих cookies нет)
function login() {
  return new Promise((resolve) => {
    const w = ensureWin();
    let done = false;
    const finish = (ok) => {
      if (done) return; done = true;
      w.webContents.removeListener('did-navigate', onNav);
      w.removeListener('hide', onHide);
      w.hide();
      resolve({ ok });
    };
    const onNav = (e, u) => { if (/^https:\/\/music\.yandex\.(ru|com|by|kz)\//.test(u) && !/passport|auth/.test(u)) setTimeout(() => finish(true), 1500); };
    const onHide = () => finish(false);
    w.webContents.on('did-navigate', onNav);
    w.on('hide', onHide);
    w.show();
    w.loadURL('https://passport.yandex.ru/auth?retpath=' + encodeURIComponent('https://music.yandex.ru/')).catch(() => {});
  });
}

function destroy() { if (win && !win.isDestroyed()) { win.__quitting = true; win.destroy(); } }

module.exports = { setup, play, stop, cmd, login, destroy };
