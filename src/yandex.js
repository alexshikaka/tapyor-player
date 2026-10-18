// Работа с Яндекс Музыкой (неофициальный API, как у сторонних клиентов)
const crypto = require('crypto');

const API = 'https://api.music.yandex.net';
const CLIENT_ID = '23cabbbdc6cd418abb4b39c32c41195d'; // публичный id клиента Яндекс Музыки
const SALT = 'XGRlBW9FXlekgbPrRHuSiA';

let log = () => {};
function setLogger(fn) { log = fn; }

function headers(token) {
  const h = {
    'X-Yandex-Music-Client': 'YandexMusicAndroid/24023621',
    'Accept-Language': 'ru',
    'User-Agent': 'Yandex-Music-API'
  };
  if (token) h.Authorization = 'OAuth ' + token;
  return h;
}

async function api(pathAndQuery, token, timeoutMs) {
  const res = await fetch(API + pathAndQuery, { headers: headers(token), signal: AbortSignal.timeout(timeoutMs || 12000) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) {
    const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200));
    err.status = res.status;
    throw err;
  }
  return j.result;
}

function cover(uri, size) { return uri ? 'https://' + String(uri).replace('%%', size) : ''; }

function fmt(ms) {
  const sec = Math.max(0, Math.round((ms || 0) / 1000));
  if (!sec) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function mapTrack(t) {
  const artists = (t.artists || []).map((a) => a.name).join(', ');
  const album = (t.albums || [])[0] || {};
  const title = t.version ? t.title + ' (' + t.version + ')' : t.title;
  const cu = t.coverUri || album.coverUri || t.ogImage;
  return {
    src: 'ym',
    id: String(t.id),
    albumId: album.id ? String(album.id) : '',
    title: title || '',
    author: artists,
    duration: fmt(t.durationMs),
    seconds: Math.round((t.durationMs || 0) / 1000),
    thumb: cover(cu, '200x200'),
    cover: cover(cu, '600x600'),
    available: t.available !== false
  };
}

// Поиск треков; «лучший результат» Яндекса ставим первым
async function search(query, token) {
  const r = await api('/search?type=track&page=0&nocorrect=false&text=' + encodeURIComponent(query), token);
  let list = ((r && r.tracks && r.tracks.results) || []).map(mapTrack);
  if (r && r.best && r.best.type === 'track' && r.best.result) {
    const b = mapTrack(r.best.result);
    list = [b].concat(list.filter((x) => x.id !== b.id));
  }
  return list.filter((x) => x.available);
}

// Подсказки при наборе
async function suggest(part, token) {
  const r = await api('/search/suggest?part=' + encodeURIComponent(part), token, 6000);
  const out = [];
  if (r && r.best && r.best.text) out.push(r.best.text);
  ((r && r.suggestions) || []).forEach((s) => { if (typeof s === 'string' && out.indexOf(s) < 0) out.push(s); });
  return out.slice(0, 8);
}

async function accountStatus(token) {
  const r = await api('/account/status', token);
  const acc = (r && r.account) || {};
  return {
    login: acc.login || '',
    name: acc.displayName || acc.fullName || acc.login || '',
    hasPlus: !!(r && r.plus && r.plus.hasPlus)
  };
}

// Прямая ссылка на mp3 трека
async function streamUrl(trackId, token) {
  const infos = await api('/tracks/' + encodeURIComponent(trackId) + '/download-info', token);
  if (!infos || !infos.length) throw new Error('нет вариантов загрузки');
  const mp3 = infos.filter((i) => i.codec === 'mp3');
  const pool = (mp3.length ? mp3 : infos).slice().sort((a, b) => (b.bitrateInKbps || 0) - (a.bitrateInKbps || 0));
  const full = pool.filter((i) => !i.preview);
  const pick = (full.length ? full : pool)[0];
  const preview = !full.length;

  const sep = pick.downloadInfoUrl.indexOf('?') >= 0 ? '&' : '?';
  const res = await fetch(pick.downloadInfoUrl + sep + 'format=json', { headers: headers(token), signal: AbortSignal.timeout(12000) });
  const txt = await res.text();
  let host, path, ts, s;
  try {
    const j = JSON.parse(txt);
    host = j.host; path = j.path; ts = j.ts; s = j.s;
  } catch (e) {
    const g = (tag) => { const m = new RegExp('<' + tag + '>([^<]*)</' + tag + '>').exec(txt); return m ? m[1] : ''; };
    host = g('host'); path = g('path'); ts = g('ts'); s = g('s');
  }
  if (!host || !path) throw new Error('не удалось разобрать ссылку загрузки');
  const sign = crypto.createHash('md5').update(SALT + path.slice(1) + s).digest('hex');
  log('Яндекс: поток ' + trackId + ' ' + (pick.bitrateInKbps || '?') + ' кбит/с' + (preview ? ' (превью)' : ''));
  return { audioUrl: 'https://' + host + '/get-mp3/' + sign + '/' + ts + path, preview: preview, bitrate: pick.bitrateInKbps };
}

module.exports = { CLIENT_ID, setLogger, search, suggest, accountStatus, streamUrl };
