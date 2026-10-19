// Вход в YouTube «ключом из браузера» (cookies) и окном Google внутри Тапёра.
// Ключ хранится зашифрованным (safeStorage), кладётся в сессию программы (для плеера YouTube с Premium)
// и в файл cookies для yt-dlp. В журнал значения cookies не пишутся никогда.
const { BrowserWindow, session, safeStorage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');

let log = () => {};
let store = { get: () => null, set: () => {} }; // чтение/запись настроек
let cookieFile = '';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const NEED_SID = ['__Secure-3PSID', '__Secure-1PSID', 'SID'];
const NEED_API = ['__Secure-3PAPISID', 'SAPISID', '__Secure-1PAPISID'];

function setup(o) { log = o.log || log; store = o.store || store; cookieFile = o.cookieFile || cookieFile; }

// ---------- Разбор вставленного текста ----------
function unescapeCmd(s) { return s.replace(/\^(.)/g, '$1'); }
function splitCookieString(str) {
  const out = [];
  String(str || '').split(/;\s*/).forEach((p) => {
    const i = p.indexOf('=');
    if (i <= 0) return;
    const name = p.slice(0, i).trim(), value = p.slice(i + 1).trim();
    if (/^[\w.$%@!#&*+\-^`|~]+$/.test(name)) out.push({ name, value });
  });
  return out;
}
// Понимаем: cURL (bash/cmd/POSIX, -b или -H 'cookie:'), PowerShell, заголовки запроса, строку cookie, файл cookies.txt
function parse(text) {
  let t = String(text || '').trim();
  if (!t) return { error: 'empty' };
  let kind = 'text', cookies = [];
  if (/^curl\s/i.test(t) || /\bcurl\s+\^?["']https?:/i.test(t)) {
    kind = 'curl';
    if (/\^["\\]/.test(t)) { t = unescapeCmd(t); kind = 'curl-cmd'; }
    t = t.replace(/\\\r?\n/g, ' ');
    let m;
    const reB = /(?:^|\s)(?:-b|--cookie)\s+(['"])([\s\S]*?)\1/g;
    while ((m = reB.exec(t))) cookies = cookies.concat(splitCookieString(m[2]));
    const reH = /(?:-H|--header)\s+(['"])\s*cookie\s*:\s*([\s\S]*?)\1/gi;
    while ((m = reH.exec(t))) cookies = cookies.concat(splitCookieString(m[2]));
  } else if (/System\.Net\.Cookie\(/.test(t)) {
    kind = 'powershell';
    const re = /System\.Net\.Cookie\(\s*"([^"]+)"\s*,\s*"([^"]*)"/g;
    let m; while ((m = re.exec(t))) cookies.push({ name: m[1], value: m[2] });
  } else if (/^[^\s]*youtube\.com\t(TRUE|FALSE)\t/m.test(t)) {
    kind = 'cookies.txt';
    t.split(/\r?\n/).forEach((ln) => { const p = ln.split('\t'); if (p.length >= 7 && /youtube\.com$/.test(p[0].replace(/^#HttpOnly_/, ''))) cookies.push({ name: p[5], value: p[6] }); });
  } else {
    const m = /^\s*cookie\s*:\s*(.+)$/im.exec(t);
    if (m) { kind = 'headers'; cookies = splitCookieString(m[1]); }
    else if (/=/.test(t) && !/\s{2,}|\n.*\n/.test(t.replace(/;\s*/g, ';'))) { kind = 'cookie-string'; cookies = splitCookieString(t.replace(/^cookie\s*:\s*/i, '')); }
  }
  // одинаковые имена — берём последнее
  const map = new Map(); cookies.forEach((c) => map.set(c.name, c.value));
  cookies = Array.from(map, ([name, value]) => ({ name, value }));
  const names = new Set(cookies.map((c) => c.name));
  const fromYt = /youtube\.com/i.test(text) || kind === 'cookie-string' || kind === 'headers';
  const hasSid = NEED_SID.some((n) => names.has(n)), hasApi = NEED_API.some((n) => names.has(n));
  if (!cookies.length) return { error: kind === 'text' ? 'not-recognized' : 'no-cookies', kind };
  if (!hasSid || !hasApi) return { error: 'not-logged-in', kind, count: cookies.length, fromYt, wrongSite: !/youtube\.com/i.test(text) && kind.startsWith('curl') };
  return { ok: true, kind, cookies, count: cookies.length };
}

// ---------- Хранение ----------
function encrypt(obj) {
  const s = JSON.stringify(obj);
  return (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')).toString('base64');
}
function decrypt(v) {
  try { const b = Buffer.from(v, 'base64'); return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8')); }
  catch (e) { log('YouTube: не удалось прочитать сохранённый вход'); return null; }
}
function saved() { const v = store.get('ytCookies'); return v ? decrypt(v) : null; }

function writeCookieFile(cookies) {
  if (!cookieFile) return;
  const exp = Math.floor(Date.now() / 1000) + 180 * 86400;
  const lines = ['# Netscape HTTP Cookie File', '# Тапёр: вход в YouTube. Не пересылай этот файл никому.'];
  cookies.forEach((c) => {
    const host = c.name.startsWith('__Host-') ? 'www.youtube.com' : '.youtube.com';
    lines.push([host, host.startsWith('.') ? 'TRUE' : 'FALSE', '/', 'TRUE', exp, c.name, c.value].join('\t'));
  });
  try { fs.writeFileSync(cookieFile, lines.join('\n') + '\n', { mode: 0o600 }); } catch (e) { log('YouTube: файл cookies не записан — ' + e.message); }
}

async function putIntoSession(cookies) {
  const ses = session.defaultSession;
  const exp = Math.floor(Date.now() / 1000) + 180 * 86400;
  for (const c of cookies) {
    const host = c.name.startsWith('__Host-');
    try {
      await ses.cookies.set({ url: 'https://www.youtube.com/', name: c.name, value: c.value, domain: host ? undefined : '.youtube.com', path: '/', secure: true, httpOnly: /SID|SSID|HSID|LOGIN_INFO/.test(c.name), sameSite: 'no_restriction', expirationDate: exp });
    } catch (e) { /* отдельные «служебные» cookies могут не встать — это не страшно */ }
  }
}
async function sessionCookies() {
  const list = await session.defaultSession.cookies.get({ domain: 'youtube.com' }).catch(() => []);
  return list.map((c) => ({ name: c.name, value: c.value }));
}

// ---------- Проверка входа ----------
function sapisidHash(cookies) {
  const m = new Map(cookies.map((c) => [c.name, c.value]));
  const sap = m.get('SAPISID') || m.get('__Secure-3PAPISID') || m.get('__Secure-1PAPISID');
  if (!sap) return '';
  const ts = Math.floor(Date.now() / 1000), origin = 'https://www.youtube.com';
  const h = crypto.createHash('sha1').update(ts + ' ' + sap + ' ' + origin).digest('hex');
  return 'SAPISIDHASH ' + ts + '_' + h;
}
function deepFind(o, pred, depth) {
  if (!o || typeof o !== 'object' || (depth || 0) > 40) return null;
  if (pred(o)) return o;
  for (const k of Object.keys(o)) { const r = deepFind(o[k], pred, (depth || 0) + 1); if (r) return r; }
  return null;
}
async function check(cookies) {
  const ses = session.defaultSession;
  const headers = { 'user-agent': CHROME_UA, 'x-origin': 'https://www.youtube.com', 'x-youtube-client-name': '1', 'x-youtube-client-version': '2.20250101.00.00' };
  const auth = sapisidHash(cookies); if (auth) headers.authorization = auth;
  try {
    const r = await ses.fetch('https://www.youtube.com/getAccountSwitcherEndpoint', { headers, credentials: 'include', signal: AbortSignal.timeout(10000) });
    const txt = (await r.text()).replace(/^\)\]\}'\s*/, '');
    const j = JSON.parse(txt);
    const acc = deepFind(j, (x) => x.accountName && x.isSelected) || deepFind(j, (x) => x.accountName && (x.accountPhoto || x.channelHandle));
    if (acc) {
      const name = (acc.accountName && (acc.accountName.simpleText || (acc.accountName.runs || []).map((x) => x.text).join(''))) || 'аккаунт YouTube';
      const photo = acc.accountPhoto && acc.accountPhoto.thumbnails && acc.accountPhoto.thumbnails[0] ? acc.accountPhoto.thumbnails[0].url : '';
      const handle = acc.channelHandle ? (acc.channelHandle.simpleText || '') : '';
      return { ok: true, name, photo, handle };
    }
  } catch (e) { log('YouTube: проверка аккаунта (1) — ' + e.message); }
  try {
    const r = await ses.fetch('https://www.youtube.com/', { headers: { 'user-agent': CHROME_UA }, credentials: 'include', signal: AbortSignal.timeout(12000) });
    const html = await r.text();
    if (/"LOGGED_IN"\s*:\s*true/.test(html)) return { ok: true, name: 'аккаунт YouTube', photo: '' };
    return { ok: false, error: 'YouTube не узнал вход — ключ устарел или скопирован не из того места' };
  } catch (e) {
    log('YouTube: проверка аккаунта (2) — ' + e.message);
    return { ok: false, network: true, error: 'YouTube не отвечает — возможно, нужен VPN на весь компьютер' };
  }
}

// Вставка ключа: разбор → в сессию → проверка → сохранение
async function loginWithText(text) {
  const p = parse(text);
  if (!p.ok) { log('YouTube: ключ не принят (' + p.error + ', формат ' + (p.kind || '?') + ', записей ' + (p.count || 0) + ')'); return p; }
  await putIntoSession(p.cookies);
  const c = await check(p.cookies);
  log('YouTube: ключ из браузера (' + p.kind + ', записей ' + p.count + ') — ' + (c.ok ? 'вход подтверждён' : 'проверка не прошла: ' + c.error));
  if (!c.ok && !c.network) { await clearSession(); return { error: 'rejected', message: c.error }; }
  store.set('ytCookies', encrypt({ cookies: p.cookies, at: Date.now(), via: 'paste' }));
  store.set('ytAccount', { name: c.name || 'аккаунт YouTube', photo: c.photo || '', via: 'paste', unchecked: !c.ok });
  writeCookieFile(p.cookies);
  return { ok: true, name: c.name, photo: c.photo, count: p.count, unchecked: !c.ok, message: c.ok ? '' : c.error };
}

// Окно входа Google внутри Тапёра
function loginWindow(parent) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({ width: 500, height: 720, parent: parent || undefined, modal: !!parent, autoHideMenuBar: true, title: 'Вход в YouTube', backgroundColor: '#ffffff' });
    win.webContents.setUserAgent(CHROME_UA);
    win.webContents.setWindowOpenHandler(({ url }) => { win.loadURL(url); return { action: 'deny' }; });
    let done = false;
    const finish = async (r) => { if (done) return; done = true; if (!win.isDestroyed()) win.close(); resolve(r); };
    const onNav = async (e, u) => {
      if (/signin\/rejected|disallowed_useragent|\/deniedsigninrejected/i.test(u)) { log('YouTube: Google не пустил вход во встроенном окне'); finish({ error: 'blocked' }); return; }
      if (/^https:\/\/(www|m)\.youtube\.com\//.test(u)) {
        const cookies = await sessionCookies();
        const names = new Set(cookies.map((c) => c.name));
        if (!NEED_SID.some((n) => names.has(n))) return; // ещё не вошёл
        const c = await check(cookies);
        store.set('ytCookies', encrypt({ cookies, at: Date.now(), via: 'window' }));
        store.set('ytAccount', { name: c.name || 'аккаунт YouTube', photo: c.photo || '', via: 'window', unchecked: !c.ok });
        writeCookieFile(cookies);
        log('YouTube: вход в окне — ' + (c.ok ? 'подтверждён' : 'не проверен'));
        finish({ ok: true, name: c.name, photo: c.photo });
      }
    };
    win.webContents.on('did-navigate', onNav);
    win.webContents.on('did-redirect-navigation', onNav);
    win.webContents.on('did-finish-load', async () => {
      try {
        const txt = await win.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 2000) : ""');
        if (/may not be secure|небезопасн|не удалось войти|couldn.t sign you in/i.test(txt)) { log('YouTube: Google показал «браузер небезопасен»'); finish({ error: 'blocked' }); }
      } catch (e) {}
    });
    win.on('closed', () => finish({ error: 'cancelled' }));
    win.loadURL('https://accounts.google.com/ServiceLogin?service=youtube&hl=ru&continue=' + encodeURIComponent('https://www.youtube.com/'));
  });
}

async function clearSession() {
  const ses = session.defaultSession;
  for (const d of ['youtube.com', 'google.com']) {
    const list = await ses.cookies.get({ domain: d }).catch(() => []);
    for (const c of list) {
      const url = 'https://' + (c.domain || d).replace(/^\./, '') + (c.path || '/');
      await ses.cookies.remove(url, c.name).catch(() => {});
    }
  }
}
async function logout() {
  await clearSession();
  store.set('ytCookies', null); store.set('ytAccount', null);
  try { if (cookieFile && fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile); } catch (e) {}
  log('YouTube: выход (ключ удалён)');
  return { ok: true };
}

// При запуске: если сессия потеряла cookies — вернуть из сохранённого
async function restore() {
  const s = saved();
  if (!s || !s.cookies) return;
  const have = await sessionCookies();
  if (!NEED_SID.some((n) => have.some((c) => c.name === n))) await putIntoSession(s.cookies);
  if (cookieFile && !fs.existsSync(cookieFile)) writeCookieFile(s.cookies);
}
function hasCookies() { return !!(cookieFile && fs.existsSync(cookieFile) && store.get('ytCookies')); }

module.exports = { setup, parse, loginWithText, loginWindow, logout, restore, hasCookies, check, CHROME_UA };
