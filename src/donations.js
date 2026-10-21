// Сервисы донатов: DonationAlerts (вход через официальное окно DA), DonatePay и Donatello (API-ключ стримера).
// Тапёр только читает донаты: вывести деньги или поменять настройки кошелька этим доступом нельзя.
// Ключи и токены хранятся зашифрованно (safeStorage) и никогда не пишутся в лог.
const { shell, safeStorage } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DA_PORT = 47219; // адрес возврата, записанный в приложении DonationAlerts: http://127.0.0.1:47219/da-callback
const DA_REDIRECT = 'http://127.0.0.1:' + DA_PORT + '/da-callback';
const DA_SCOPES = 'oauth-user-show oauth-donation-index';
const POLL = { da: 12000, dp: 25000, dn: 20000 }; // DonatePay просит не чаще раза в 20 с
const NAMES = { da: 'DonationAlerts', dp: 'DonatePay', dn: 'Donatello' };

let log = () => {};
let store = { get: () => null, set: () => {} };
let onDonation = () => {};
let onStatus = () => {};
const state = { da: {}, dp: {}, dn: {} };
const timers = {};

function setup(o) { log = o.log || log; store = o.store || store; onDonation = o.onDonation || onDonation; onStatus = o.onStatus || onStatus; }
function enc(s) { return (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')).toString('base64'); }
function dec(v) { try { const b = Buffer.from(v, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'); } catch (e) { return ''; } }
function secrets() { return store.get('donKeys') || {}; }
function secret(p) { const s = secrets()[p]; return s ? JSON.parse(dec(s) || 'null') : null; }
function setSecret(p, v) { const s = secrets(); if (v == null) delete s[p]; else s[p] = enc(JSON.stringify(v)); store.set('donKeys', s); }
function daConfig() {
  for (const p of [path.join(__dirname, 'da.json'), path.join(process.resourcesPath || '', 'da.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.clientId) return j; } catch (e) {}
  }
  return null;
}
async function getJson(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(15000) }, opts || {}));
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) { const err = new Error('HTTP ' + r.status + (j && (j.message || j.error) ? ': ' + (j.message || j.error) : '')); err.status = r.status; throw err; }
  if (j == null) throw new Error('сервис ответил не JSON');
  return j;
}
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.').replace(/\s/g, '')); return isFinite(n) ? n : 0; };
const when = (v) => { const t = Date.parse(String(v || '').replace(' ', 'T').replace(/\.\d+$/, '')); return isFinite(t) ? t : Date.now(); };

// --- DonationAlerts ---
let daPending = null;
function daLogin() {
  const cfg = daConfig();
  if (!cfg) return Promise.resolve({ error: 'not-configured' });
  if (daPending) { try { daPending.cancel(); } catch (e) {} }
  return new Promise((resolve) => {
    const st = crypto.randomBytes(12).toString('hex');
    let done = false;
    const page = (ok, t) => '<!doctype html><meta charset="utf-8"><title>Тапёр</title><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#15161C;color:#ECEDF2;font:16px Segoe UI,system-ui,sans-serif"><div style="text-align:center;max-width:420px"><div style="font-size:44px">' + (ok ? '✓' : '⚠') + '</div><h2>' + (ok ? 'Готово!' : 'Вход не выполнен') + '</h2><p style="color:#9EA2B0">' + t + '</p></div>';
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/da-callback') { res.writeHead(404); res.end(); return; }
      const code = u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (!code || (u.searchParams.get('state') && u.searchParams.get('state') !== st)) { res.end(page(false, 'DonationAlerts не выдал доступ. Закрой вкладку и попробуй ещё раз в Тапёре.')); finish({ error: u.searchParams.get('error') || 'no-code' }); return; }
      try {
        const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: cfg.clientId, client_secret: cfg.clientSecret || '', redirect_uri: DA_REDIRECT, code });
        const j = await getJson('https://www.donationalerts.com/oauth/token', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!j.access_token) throw new Error('нет токена');
        setSecret('da', { at: j.access_token, rt: j.refresh_token || '', exp: Date.now() + (j.expires_in || 3600 * 24 * 30) * 1000 - 60000 });
        const me = await daMe().catch(() => null);
        store.set('donAccounts', Object.assign({}, store.get('donAccounts') || {}, { da: { name: (me && me.name) || 'DonationAlerts', avatar: (me && me.avatar) || '' } }));
        res.end(page(true, 'Тапёр подключён к DonationAlerts' + (me ? ' как ' + String(me.name).replace(/[<>]/g, '') : '') + '. Он видит только донаты. Эту вкладку можно закрыть.'));
        log('Донаты: DonationAlerts подключён');
        markAllSeen('da').catch(() => {});
        finish({ ok: true, name: me && me.name });
      } catch (e) {
        log('Донаты: DonationAlerts — ошибка входа ' + e.message);
        res.end(page(false, 'Ошибка: ' + String(e.message).replace(/[<>]/g, '') + '. Закрой вкладку и попробуй ещё раз.'));
        finish({ error: e.message });
      }
    });
    const timer = setTimeout(() => finish({ error: 'timeout' }), 5 * 60 * 1000);
    function finish(r) { if (done) return; done = true; clearTimeout(timer); setTimeout(() => { try { server.close(); } catch (e) {} }, 1500); daPending = null; if (r.ok) startPoll('da'); onStatus(); resolve(r); }
    daPending = { cancel: () => finish({ error: 'cancelled' }) };
    server.on('error', (e) => finish({ error: e.code === 'EADDRINUSE' ? 'порт ' + DA_PORT + ' занят другой программой' : e.message }));
    server.listen(DA_PORT, '127.0.0.1', () => {
      const url = 'https://www.donationalerts.com/oauth/authorize?' + new URLSearchParams({ client_id: cfg.clientId, redirect_uri: DA_REDIRECT, response_type: 'code', scope: DA_SCOPES, state: st }).toString();
      shell.openExternal(url);
      log('Донаты: открыл окно входа DonationAlerts');
    });
  });
}
async function daToken() {
  const s = secret('da'); if (!s) return null;
  if (s.exp > Date.now()) return s.at;
  const cfg = daConfig(); if (!cfg || !s.rt) return s.at;
  try {
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.rt, client_id: cfg.clientId, client_secret: cfg.clientSecret || '', scope: DA_SCOPES });
    const j = await getJson('https://www.donationalerts.com/oauth/token', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (j.access_token) { setSecret('da', { at: j.access_token, rt: j.refresh_token || s.rt, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 }); return j.access_token; }
  } catch (e) { log('Донаты: DonationAlerts — не обновился вход ' + e.message); }
  return s.at;
}
async function daMe() { const t = await daToken(); const j = await getJson('https://www.donationalerts.com/api/v1/user/oauth', { headers: { Authorization: 'Bearer ' + t } }); return j.data || j; }
async function daList() {
  const t = await daToken(); if (!t) throw new Error('не подключён');
  const j = await getJson('https://www.donationalerts.com/api/v1/alerts/donations?page=1', { headers: { Authorization: 'Bearer ' + t } });
  return (j.data || []).map((d) => ({ prov: 'da', id: String(d.id), name: d.username || d.name || 'Аноним', text: d.message || '', amount: num(d.amount), currency: d.currency || '', amountMain: d.amount_in_user_currency != null ? num(d.amount_in_user_currency) : null, at: when(d.created_at), kind: d.message_type || 'text' }));
}

// --- DonatePay (ключ из «Настройки → API» на donatepay.ru) ---
async function dpMe(key) { const j = await getJson('https://donatepay.ru/api/v1/user?access_token=' + encodeURIComponent(key)); if (j.status && j.status !== 'success') throw new Error(j.message || 'ключ не подошёл'); return j.data || j; }
async function dpList() {
  const s = secret('dp'); if (!s) throw new Error('не подключён');
  const j = await getJson('https://donatepay.ru/api/v1/transactions?' + new URLSearchParams({ access_token: s.key, type: 'donation', status: 'success', limit: '25', order: 'DESC' }).toString());
  if (j.status && j.status !== 'success') throw new Error(j.message || 'ошибка DonatePay');
  return (j.data || []).map((d) => { const v = d.vars || {}; return { prov: 'dp', id: String(d.id), name: v.name || d.name || 'Аноним', text: v.comment || d.comment || d.what || '', amount: num(d.sum), currency: 'RUB', amountMain: null, at: when((d.created_at && d.created_at.date) || d.created_at) }; });
}
// --- Donatello (токен в разделе «API» на donatello.to; там же включить доступ) ---
async function dnMe(key) { return getJson('https://donatello.to/api/v1/me', { headers: { 'X-Token': key } }); }
async function dnList() {
  const s = secret('dn'); if (!s) throw new Error('не подключён');
  const j = await getJson('https://donatello.to/api/v1/donates?page=0&size=20', { headers: { 'X-Token': s.key } });
  return (j.content || j.data || []).map((d) => ({ prov: 'dn', id: String(d.pubId || d.id), name: d.clientName || d.name || 'Аноним', text: d.message || '', amount: num(d.amount), currency: d.currency || 'UAH', amountMain: null, at: when(d.createdAt) }));
}
const LIST = { da: daList, dp: dpList, dn: dnList };

async function setKey(p, key) {
  key = String(key || '').trim();
  if (!key) { disconnect(p); return { ok: true }; }
  try {
    const me = p === 'dp' ? await dpMe(key) : await dnMe(key);
    setSecret(p, { key });
    store.set('donAccounts', Object.assign({}, store.get('donAccounts') || {}, { [p]: { name: (me && (me.name || me.nickname || me.login)) || NAMES[p], avatar: (me && (me.avatar || me.avatarUrl)) || '' } }));
    log('Донаты: ' + NAMES[p] + ' подключён');
    await markAllSeen(p).catch(() => {});
    startPoll(p); onStatus();
    return { ok: true, name: me && (me.name || me.nickname) };
  } catch (e) { log('Донаты: ' + NAMES[p] + ' — ключ не подошёл (' + e.message + ')'); return { error: e.status === 401 || e.status === 403 ? 'ключ не подошёл' : e.message }; }
}
function disconnect(p) {
  setSecret(p, null); stopPoll(p); state[p] = {};
  const a = Object.assign({}, store.get('donAccounts') || {}); delete a[p]; store.set('donAccounts', a);
  log('Донаты: ' + NAMES[p] + ' отключён'); onStatus();
  return true;
}

// Уже показанные донаты: не повторять и не заваливать старыми при первом подключении
function seen() { return store.get('donSeen') || {}; }
function addSeen(p, ids) { const s = seen(); const cur = s[p] || []; ids.forEach((id) => { if (cur.indexOf(id) < 0) cur.push(id); }); s[p] = cur.slice(-400); store.set('donSeen', s); }
async function markAllSeen(p) { const list = await LIST[p](); addSeen(p, list.map((d) => d.id)); }

async function poll(p, first) {
  try {
    const list = await LIST[p]();
    const was = seen()[p] || [];
    const fresh = list.filter((d) => was.indexOf(d.id) < 0).sort((a, b) => a.at - b.at);
    state[p] = { ok: true, at: Date.now() };
    if (fresh.length) {
      addSeen(p, fresh.map((d) => d.id));
      // после запуска Тапёра — только за последние сутки, с пометкой «до запуска»
      fresh.forEach((d) => { if (first) { if (Date.now() - d.at > 24 * 3600 * 1000) return; d.missed = true; } onDonation(d); });
    }
  } catch (e) {
    const msg = e.status === 401 || e.status === 403 ? 'вход устарел — подключи заново' : e.message;
    if (state[p].error !== msg) log('Донаты: ' + NAMES[p] + ' — ' + msg);
    state[p] = { ok: false, error: msg, at: Date.now() };
  }
  onStatus();
}
function startPoll(p) {
  stopPoll(p);
  let first = true;
  const tick = async () => { await poll(p, first); first = false; timers[p] = setTimeout(tick, POLL[p]); };
  timers[p] = setTimeout(tick, 1500);
}
function stopPoll(p) { if (timers[p]) clearTimeout(timers[p]); timers[p] = null; }
function start() { ['da', 'dp', 'dn'].forEach((p) => { if (secret(p)) startPoll(p); }); }

function status() {
  const acc = store.get('donAccounts') || {};
  const out = {};
  ['da', 'dp', 'dn'].forEach((p) => {
    out[p] = { name: NAMES[p], connected: !!secret(p), account: acc[p] || null, ok: state[p].ok, error: state[p].error || '', at: state[p].at || 0 };
  });
  out.da.configured = !!daConfig();
  return out;
}
async function check() { // для самопроверки
  const r = {};
  for (const p of ['da', 'dp', 'dn']) { if (!secret(p)) continue; try { await LIST[p](); r[p] = { ok: true }; } catch (e) { r[p] = { ok: false, error: e.message }; } }
  return r;
}

module.exports = { setup, start, status, daLogin, daCancel: () => { if (daPending) daPending.cancel(); }, setKey, disconnect, check, DA_REDIRECT, NAMES };
