// Вход в YouTube через обычный браузер (официальный вход Google, OAuth 2.0 для приложений на ПК).
// Даёт доступ к своим плейлистам и лайкам через YouTube Data API. Premium этим способом не включается.
// Нужен Client ID проекта Google Cloud: файл google-oauth.json рядом с программой
// { "clientId": "....apps.googleusercontent.com", "clientSecret": "..." } (тип клиента «Приложение для ПК»).
const { shell, safeStorage, net } = require('electron');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let log = () => {};
let store = { get: () => null, set: () => {} };
let access = null; // { token, exp }

function setup(o) { log = o.log || log; store = o.store || store; }
function config() {
  for (const p of [path.join(__dirname, 'google-oauth.json'), path.join(process.resourcesPath || '', 'google-oauth.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.clientId) return j; } catch (e) {}
  }
  return null;
}
function configured() { return !!config(); }
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function enc(s) { return (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(s) : Buffer.from(s, 'utf8')).toString('base64'); }
function dec(v) { try { const b = Buffer.from(v, 'base64'); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'); } catch (e) { return ''; } }

const PAGE = (title, text) => '<!doctype html><meta charset="utf-8"><title>Тапёр</title><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#15161C;color:#ECEDF2;font:16px Segoe UI,system-ui,sans-serif"><div style="text-align:center;max-width:420px"><div style="font-size:44px">' + (title.startsWith('Готово') ? '✓' : '⚠') + '</div><h2>' + title + '</h2><p style="color:#9EA2B0">' + text + '</p></div>';

let pending = null;
function login() {
  const cfg = config();
  if (!cfg) return Promise.resolve({ error: 'not-configured' });
  if (pending) { try { pending.cancel(); } catch (e) {} }
  return new Promise((resolve) => {
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    let done = false;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/cb') { res.writeHead(404); res.end(); return; }
      const code = u.searchParams.get('code');
      if (u.searchParams.get('state') !== state || !code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Вход не выполнен', u.searchParams.get('error') === 'access_denied' ? 'Ты нажал «Отмена». Можно закрыть вкладку и попробовать ещё раз в Тапёре.' : 'Что-то пошло не так. Закрой вкладку и попробуй ещё раз.'));
        finish({ error: u.searchParams.get('error') || 'no-code' }); return;
      }
      try {
        const body = new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret || '', redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
        const r = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const j = await r.json();
        if (!j.access_token) throw new Error(j.error_description || j.error || 'нет токена');
        access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
        if (j.refresh_token) store.set('ytOauth', enc(j.refresh_token));
        const me = await channel().catch(() => null);
        store.set('ytOauthAccount', me ? { name: me.name, photo: me.photo } : { name: 'аккаунт Google' });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Готово!', 'Тапёр подключён к YouTube' + (me ? ' как ' + me.name : '') + '. Эту вкладку можно закрыть.'));
        log('YouTube (через браузер): вход выполнен');
        finish({ ok: true, name: me && me.name, photo: me && me.photo });
      } catch (e) {
        log('YouTube (через браузер): ошибка обмена кода — ' + e.message);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE('Вход не выполнен', 'Google не выдал доступ: ' + String(e.message).replace(/[<>]/g, '') + '. Закрой вкладку и попробуй ещё раз.'));
        finish({ error: e.message });
      }
    });
    let redirect = '';
    const timer = setTimeout(() => finish({ error: 'timeout' }), 5 * 60 * 1000);
    function finish(r) { if (done) return; done = true; clearTimeout(timer); setTimeout(() => server.close(), 1500); pending = null; resolve(r); }
    pending = { cancel: () => finish({ error: 'cancelled' }) };
    server.listen(0, '127.0.0.1', () => {
      redirect = 'http://127.0.0.1:' + server.address().port + '/cb';
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.readonly',
        code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state
      }).toString();
      shell.openExternal(url);
      log('YouTube (через браузер): открыл страницу входа Google');
    });
  });
}
function cancel() { if (pending) pending.cancel(); }

async function token() {
  if (access && Date.now() < access.exp) return access.token;
  const cfg = config(); const rt = store.get('ytOauth') ? dec(store.get('ytOauth')) : '';
  if (!cfg || !rt) return null;
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret || '', refresh_token: rt, grant_type: 'refresh_token' });
  const r = await net.fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: body.toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) {
    log('YouTube (через браузер): доступ не обновился — ' + (j.error || r.status));
    if (j.error === 'invalid_grant') { store.set('ytOauth', null); store.set('ytOauthAccount', null); }
    return null;
  }
  access = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 - 60000 };
  return access.token;
}
async function api(pathq) {
  const t = await token(); if (!t) throw new Error('нет входа');
  const r = await net.fetch('https://www.googleapis.com/youtube/v3/' + pathq, { headers: { Authorization: 'Bearer ' + t } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j.error && j.error.message) || ('HTTP ' + r.status));
  return j;
}
function isoDur(s) { const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || ''); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; }
function fmt(sec) { if (!sec) return ''; const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; const p = (n) => (n < 10 ? '0' : '') + n; return h ? h + ':' + p(m) + ':' + p(x) : m + ':' + p(x); }
function thumbOf(sn) { const t = sn && sn.thumbnails; return t ? ((t.medium || t.default || t.high || {}).url || '') : ''; }

async function channel() {
  const j = await api('channels?part=snippet&mine=true');
  const c = (j.items || [])[0]; if (!c) return null;
  return { name: c.snippet.title, photo: thumbOf(c.snippet) };
}
async function myPlaylists() {
  const out = []; let page = '';
  for (let k = 0; k < 5; k++) {
    const j = await api('playlists?part=snippet,contentDetails&mine=true&maxResults=50' + (page ? '&pageToken=' + page : ''));
    (j.items || []).forEach((p) => out.push({ src: 'yt', type: 'playlist', listId: p.id, title: p.snippet.title, author: p.snippet.channelTitle || '', count: (p.contentDetails && p.contentDetails.itemCount) || 0, thumb: thumbOf(p.snippet), mine: true }));
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return out;
}
async function videoDetails(ids) {
  const map = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const j = await api('videos?part=contentDetails&id=' + ids.slice(i, i + 50).join(','));
    (j.items || []).forEach((v) => map.set(v.id, isoDur(v.contentDetails && v.contentDetails.duration)));
  }
  return map;
}
async function playlistTracks(listId, title) {
  const items = []; let page = '';
  for (let k = 0; k < 10; k++) {
    const j = await api('playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=' + encodeURIComponent(listId) + (page ? '&pageToken=' + page : ''));
    (j.items || []).forEach((it) => { const id = it.contentDetails && it.contentDetails.videoId; if (id && it.snippet && !/^(Deleted|Private) video$/i.test(it.snippet.title)) items.push({ id, sn: it.snippet }); });
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  const d = await videoDetails(items.map((x) => x.id)).catch(() => new Map());
  const tracks = items.map((x) => ({ src: 'yt', id: x.id, title: x.sn.title, author: (x.sn.videoOwnerChannelTitle || '').replace(/\s*-\s*Topic$/i, ''), seconds: d.get(x.id) || 0, duration: fmt(d.get(x.id) || 0), thumb: thumbOf(x.sn) || ('https://i.ytimg.com/vi/' + x.id + '/mqdefault.jpg') }));
  return { src: 'yt', type: 'playlist', listId, title: title || 'Плейлист YouTube', count: tracks.length, thumb: tracks[0] ? tracks[0].thumb : '', tracks };
}
async function liked() {
  const out = []; let page = '';
  for (let k = 0; k < 10; k++) {
    const j = await api('videos?part=snippet,contentDetails&myRating=like&maxResults=50' + (page ? '&pageToken=' + page : ''));
    (j.items || []).forEach((v) => { const s = isoDur(v.contentDetails && v.contentDetails.duration); out.push({ src: 'yt', id: v.id, title: v.snippet.title, author: (v.snippet.channelTitle || '').replace(/\s*-\s*Topic$/i, ''), seconds: s, duration: fmt(s), thumb: thumbOf(v.snippet) }); });
    if (!j.nextPageToken) break; page = j.nextPageToken;
  }
  return { src: 'yt', type: 'liked', title: 'Понравившиеся на YouTube', count: out.length, thumb: out[0] ? out[0].thumb : '', tracks: out };
}
function loggedIn() { return !!store.get('ytOauth'); }
function logout() { store.set('ytOauth', null); store.set('ytOauthAccount', null); access = null; log('YouTube (через браузер): выход'); return { ok: true }; }

module.exports = { setup, configured, login, cancel, loggedIn, logout, myPlaylists, playlistTracks, liked, channel };
