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
    album: album.title || '',
    available: t.available !== false,
    // громкость трека (EBU R128) и точки затухания — для ровной громкости и плавных переходов
    lufs: t.r128 && typeof t.r128.i === 'number' ? t.r128.i : undefined,
    fadeOut: t.fade && typeof t.fade.outStart === 'number' ? t.fade.outStart : undefined
  };
}

// Поиск: треки (лучший результат первым), плейлисты и исполнители одним запросом
async function search(query, token) {
  const r = await api('/search?type=all&page=0&nocorrect=false&text=' + encodeURIComponent(query), token);
  let list = ((r && r.tracks && r.tracks.results) || []).map(mapTrack);
  if (r && r.best && r.best.type === 'track' && r.best.result) {
    const b = mapTrack(r.best.result);
    list = [b].concat(list.filter((x) => x.id !== b.id));
  }
  const playlists = ((r && r.playlists && r.playlists.results) || []).map(mapPlaylist).filter((p) => p.count > 0).slice(0, 8);
  let artists = ((r && r.artists && r.artists.results) || []).map(mapArtist);
  if (r && r.best && r.best.type === 'artist' && r.best.result) {
    const b = mapArtist(r.best.result);
    artists = [b].concat(artists.filter((x) => x.id !== b.id));
  }
  return { tracks: list.filter((x) => x.available), playlists, artists: artists.slice(0, 5), total: (r && r.tracks && r.tracks.total) || 0 };
}

// Следующие страницы треков (для прокрутки при фильтре «Яндекс»)
async function searchTracksPage(query, page, token) {
  const r = await api('/search?type=track&page=' + (page || 0) + '&nocorrect=false&text=' + encodeURIComponent(query), token);
  return ((r && r.tracks && r.tracks.results) || []).map(mapTrack).filter((x) => x.available);
}

function playlistCover(p) {
  const c = p.cover || {};
  return c.uri || (c.itemsUri || [])[0] || p.ogImage || '';
}
function mapPlaylist(p) {
  const owner = p.owner || {};
  return {
    src: 'ym', type: 'playlist',
    uid: String(owner.uid || p.uid || ''), kind: String(p.kind != null ? p.kind : ''),
    uuid: p.playlistUuid || '',
    title: p.title || '',
    author: owner.name || owner.login || '',
    count: p.trackCount || (p.tracks ? p.tracks.length : 0),
    thumb: cover(playlistCover(p), '200x200')
  };
}
function mapArtist(a) {
  const c = (a.cover && (a.cover.uri || a.cover.prefix)) || a.ogImage || '';
  return { id: String(a.id), name: a.name || '', thumb: c ? cover(c, '200x200') : '' };
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
  // аватарка — по возможности (Яндекс ID), без неё кнопка покажет первую букву имени
  let avatar = '';
  try {
    const res = await fetch('https://login.yandex.ru/info?format=json', { headers: { Authorization: 'OAuth ' + token }, signal: AbortSignal.timeout(5000) });
    if (res.ok) { const j = await res.json(); if (j && j.default_avatar_id && !j.is_avatar_empty) avatar = 'https://avatars.yandex.net/get-yapic/' + j.default_avatar_id + '/islands-middle'; }
  } catch (e) { /* без аватарки */ }
  return {
    uid: acc.uid ? String(acc.uid) : '',
    login: acc.login || '',
    name: acc.displayName || acc.fullName || acc.login || '',
    hasPlus: !!(r && r.plus && r.plus.hasPlus),
    avatar
  };
}

async function apiPost(pathAndQuery, token, json) {
  const h = headers(token);
  h['Content-Type'] = 'application/json';
  const res = await fetch(API + pathAndQuery, { method: 'POST', headers: h, body: JSON.stringify(json || {}), signal: AbortSignal.timeout(12000) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) { const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200)); err.status = res.status; throw err; }
  return j.result;
}

async function apiForm(pathAndQuery, token, fields) {
  const h = headers(token);
  h['Content-Type'] = 'application/x-www-form-urlencoded';
  const res = await fetch(API + pathAndQuery, { method: 'POST', headers: h, body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(15000) });
  const txt = await res.text();
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('HTTP ' + res.status + ': ' + txt.slice(0, 200)); }
  if (!res.ok || j.error) { const err = new Error('HTTP ' + res.status + ': ' + JSON.stringify(j.error || j).slice(0, 200)); err.status = res.status; throw err; }
  return j.result;
}

// --- Волны (радио Яндекса) ---
// Обычная станция: 'user:onyourwave', 'genre:rock', 'artist:123', 'mood:calm' …
// «Сессия» по семенам — так новое приложение Яндекса включает свои варианты волны
const WAVE = 'user:onyourwave';
let wave = { kind: 'station', station: WAVE, batch: '', session: '' };

// mood: all | active | fun | calm | sad;  diversity: default | favorite | discover | popular;
// language: any | russian | not-russian | without-words
async function waveStart(token, o) {
  o = o || {};
  const seeds = Array.isArray(o.seeds) ? o.seeds.filter(Boolean) : [];
  if (seeds.length) {
    try {
      const r = await apiPost('/rotor/session/new', token, { seeds: seeds, includeTracksInResponse: true });
      wave = { kind: 'session', station: seeds[0], batch: (r && r.batchId) || '', session: (r && r.radioSessionId) || '' };
      const list = seqTracks(r);
      log('Волна (сессия): ' + seeds.join(',') + ' → треков ' + list.length);
      if (list.length) return list;
    } catch (e) { log('Волна (сессия) не запустилась: ' + e.message + ' — пробую как станцию'); }
  }
  const station = o.station || (seeds.find((x) => /^[a-z-]+:[^:]+$/i.test(x) && !/^setting/i.test(x))) || WAVE;
  wave = { kind: 'station', station: station, batch: '', session: '' };
  try {
    await apiPost('/rotor/station/' + station + '/settings2', token, {
      moodEnergy: o.mood || 'all',
      diversity: o.diversity || 'default',
      language: o.language || 'any'
    });
  } catch (e) { log('Волна: настройки для ' + station + ' не применились — ' + e.message); }
  await waveFeedback(token, 'radioStarted');
  return waveTracks(token, '');
}

function seqTracks(r) {
  return ((r && r.sequence) || []).map((x) => x && x.track).filter(Boolean).map(mapTrack).filter((t) => t.available);
}

async function waveTracks(token, lastId) {
  let r;
  if (wave.kind === 'session' && wave.session) {
    r = await apiPost('/rotor/session/' + encodeURIComponent(wave.session) + '/tracks', token, { queue: lastId ? [lastId] : [] });
  } else {
    r = await api('/rotor/station/' + wave.station + '/tracks?settings2=true' + (lastId ? '&queue=' + encodeURIComponent(lastId) : ''), token);
  }
  if (r && r.batchId) wave.batch = r.batchId;
  const list = seqTracks(r);
  log('Волна ' + wave.station + ': получено треков ' + list.length);
  return list;
}

// Обратная связь, чтобы волна подстраивалась (ошибки не критичны)
async function waveFeedback(token, type, trackKey, played) {
  const ts = new Date().toISOString();
  try {
    if (wave.kind === 'session' && wave.session) {
      const ev = { type: type, timestamp: ts };
      if (trackKey) ev.trackId = trackKey;
      if (played != null) ev.totalPlayedSeconds = Math.max(0, Math.round(played));
      await apiPost('/rotor/session/' + encodeURIComponent(wave.session) + '/feedback', token, { event: ev, batchId: wave.batch || undefined });
      return;
    }
    const body = { type: type, timestamp: ts, from: 'mobile-radio-' + wave.station.replace(/[^a-z0-9]+/gi, '-') };
    if (trackKey) body.trackId = trackKey;
    if (played != null) body.totalPlayedSeconds = Math.max(0, Math.round(played));
    await apiPost('/rotor/station/' + wave.station + '/feedback' + (wave.batch ? '?batch-id=' + encodeURIComponent(wave.batch) : ''), token, body);
  } catch (e) { log('Волна: отзыв «' + type + '» не принят — ' + e.message); }
}

// Список всех станций: жанры, настроения, занятия, эпохи
function mapStation(st) {
  const s = (st && st.station) || st || {};
  const id = s.id ? s.id.type + ':' + s.id.tag : '';
  const icon = s.icon || s.fullImageUrl || {};
  return { id: id, type: s.id ? s.id.type : '', name: s.name || '', color: (icon.backgroundColor || '').trim(), parent: s.parentId ? s.parentId.type + ':' + s.parentId.tag : '' };
}
async function stationsList(token) {
  const r = await api('/rotor/stations/list?language=ru', token);
  return (r || []).map(mapStation).filter((x) => x.id && x.name);
}
async function stationsDashboard(token) {
  const r = await api('/rotor/stations/dashboard', token);
  return ((r && r.stations) || []).map(mapStation).filter((x) => x.id && x.name);
}

// Новые варианты волны («Работаю по-красоте», «Это поп!» …). Где их берёт приложение Яндекса,
// точно неизвестно — пробуем, пишем ответ в лог и разбираем всё, что похоже на «название + семена».
async function wavePresets(token) {
  const tries = ['/rotor/wave/settings', '/landing3/wave', '/rotor/wave/last'];
  const out = [];
  for (const p of tries) {
    try {
      const r = await api(p, token, 8000);
      log('Волна: ответ ' + p + ' → ' + JSON.stringify(r).slice(0, 1500));
      walk(r, (o) => {
        const title = o.title || o.name;
        const seeds = Array.isArray(o.seeds) ? o.seeds.filter((x) => typeof x === 'string') : null;
        if (typeof title === 'string' && seeds && seeds.length && !out.some((x) => x.name === title)) {
          out.push({ name: title, seeds: seeds, color: (o.color || (o.style && o.style.color) || '') });
        }
      });
      if (out.length) break;
    } catch (e) { log('Волна: ' + p + ' — ' + e.message); }
  }
  return out.slice(0, 12);
}
function walk(o, fn, depth) {
  depth = depth || 0;
  if (!o || typeof o !== 'object' || depth > 8) return;
  if (!Array.isArray(o)) fn(o);
  for (const k in o) walk(o[k], fn, depth + 1);
}

// --- Плейлисты и «Мне нравится» ---
async function tracksByIds(token, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await apiForm('/tracks', token, { 'track-ids': chunk.join(','), 'with-positions': 'false' });
    (r || []).forEach((t) => out.push(mapTrack(t)));
  }
  return out.filter((t) => t.available);
}
async function likedTracks(token, uid, limit) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/likes/tracks?if-modified-since-revision=0', token);
  const ids = (((r && r.library && r.library.tracks) || [])).map((t) => t.albumId ? t.id + ':' + t.albumId : String(t.id));
  const total = ids.length;
  const tracks = await tracksByIds(token, ids.slice(0, limit || 500));
  return { title: 'Мне нравится', count: total, tracks: tracks };
}
async function userPlaylists(token, uid) {
  const own = ((await api('/users/' + encodeURIComponent(uid) + '/playlists/list', token)) || []).map(mapPlaylist);
  let liked = [];
  try {
    liked = ((await api('/users/' + encodeURIComponent(uid) + '/likes/playlists', token)) || [])
      .map((x) => x && x.playlist).filter(Boolean).map((p) => Object.assign(mapPlaylist(p), { saved: true }));
  } catch (e) { log('Яндекс: сохранённые плейлисты — ' + e.message); }
  return own.concat(liked);
}
async function playlistTracks(token, pl) {
  let r;
  if (pl.uuid && !pl.kind) r = await api('/playlist/' + encodeURIComponent(pl.uuid) + '?rich-tracks=true', token);
  else r = await api('/users/' + encodeURIComponent(pl.uid) + '/playlists/' + encodeURIComponent(pl.kind) + '?rich-tracks=true', token);
  const items = (r && r.tracks) || [];
  let tracks = items.map((x) => x && x.track).filter(Boolean).map(mapTrack).filter((t) => t.available);
  if (!tracks.length && items.length) {
    tracks = await tracksByIds(token, items.map((x) => (x.albumId ? x.id + ':' + x.albumId : String(x.id))).slice(0, 500));
  }
  const meta = mapPlaylist(r || {});
  return Object.assign(meta, { title: meta.title || pl.title || 'Плейлист', count: (r && r.trackCount) || tracks.length, tracks: tracks });
}
async function albumTracks(token, albumId) {
  const r = await api('/albums/' + encodeURIComponent(albumId) + '/with-tracks', token);
  const tracks = [].concat.apply([], (r && r.volumes) || []).map(mapTrack).filter((t) => t.available);
  return { src: 'ym', type: 'album', title: (r && r.title) || 'Альбом', author: ((r && r.artists) || []).map((a) => a.name).join(', '), count: tracks.length, thumb: cover(r && r.coverUri, '200x200'), tracks: tracks };
}
async function artistTracks(token, artistId) {
  const r = await api('/artists/' + encodeURIComponent(artistId) + '/tracks?page=0&page-size=200', token);
  const tracks = ((r && r.tracks) || []).map(mapTrack).filter((t) => t.available);
  let name = '';
  try { const b = await api('/artists/' + encodeURIComponent(artistId) + '/brief-info', token, 8000); name = b && b.artist && b.artist.name; } catch (e) {}
  return { src: 'ym', type: 'artist', artistId: String(artistId), title: name || 'Исполнитель', author: 'Популярные треки', count: tracks.length, thumb: tracks[0] ? tracks[0].thumb : '', tracks: tracks };
}
// Страница исполнителя: популярное, альбомы, синглы, сборники, похожие
function mapAlbum(a) {
  const t = a.type === 'single' ? 'single' : (a.type === 'compilation' || a.type === 'podcast' ? 'compilation' : 'album');
  return { src: 'ym', id: String(a.id), title: a.version ? a.title + ' (' + a.version + ')' : (a.title || ''), year: a.year || (a.releaseDate ? Number(String(a.releaseDate).slice(0, 4)) : 0), type: t, thumb: cover(a.coverUri, '200x200'), count: a.trackCount || 0, author: ((a.artists || []).map((x) => x.name)).join(', ') };
}
async function artistInfo(token, artistId) {
  const b = await api('/artists/' + encodeURIComponent(artistId) + '/brief-info', token);
  let albums = (b && b.albums) || [];
  try { const d = await api('/artists/' + encodeURIComponent(artistId) + '/direct-albums?page=0&page-size=100&sort-by=year', token); if (d && d.albums && d.albums.length) albums = d.albums; } catch (e) {}
  const a = (b && b.artist) || {};
  const c = (a.cover && (a.cover.uri || a.cover.prefix)) || a.ogImage || '';
  const desc = a.description && (a.description.text || a.description);
  return {
    id: String(artistId), name: a.name || '', photo: c ? cover(c, '400x400') : '',
    about: typeof desc === 'string' ? desc : '',
    popular: ((b && b.popularTracks) || []).map(mapTrack).filter((t) => t.available).slice(0, 20),
    albums: albums.filter((x) => x.available !== false).map(mapAlbum),
    also: ((b && b.alsoAlbums) || []).filter((x) => x.available !== false).map((x) => Object.assign(mapAlbum(x), { type: 'compilation' })),
    similar: ((b && b.similarArtists) || []).map(mapArtist).slice(0, 16)
  };
}
// Лайки: список id и поставить/снять
async function likedIds(token, uid) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/likes/tracks?if-modified-since-revision=0', token);
  return (((r && r.library && r.library.tracks) || [])).map((t) => String(t.id));
}
async function setLike(token, uid, trackKey, on) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/likes/tracks/' + (on ? 'add-multiple' : 'remove'), token, { 'track-ids': String(trackKey) });
}
// Новый плейлист в аккаунте и добавление треков (порциями по 100)
async function createPlaylist(token, uid, title) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/create', token, { title: title, visibility: 'private' });
}
async function addToPlaylist(token, uid, kind, revision, tracks, startAt) {
  let rev = revision || 1, at = startAt || 0;
  const list = tracks.filter((t) => t && t.id && t.albumId);
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map((t) => ({ id: String(t.id), albumId: String(t.albumId) }));
    const r = await apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/change-relative', token,
      { diff: JSON.stringify([{ op: 'insert', at: at, tracks: chunk }]), revision: String(rev) });
    rev = (r && r.revision) || rev + 1;
    at += chunk.length;
  }
  return { kind: String(kind), revision: rev, count: at - (startAt || 0) };
}
async function trackById(token, id) {
  const list = await tracksByIds(token, [String(id)]);
  return list[0] || null;
}


// Управление своими плейлистами: сведения, название, удаление, треки
async function playlistInfo(token, uid, kind) {
  const r = await api('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind), token);
  return { revision: r.revision || 1, count: r.trackCount || 0, title: r.title || '', items: ((r && r.tracks) || []).map((x) => ({ id: String(x.id), albumId: x.albumId ? String(x.albumId) : '' })) };
}
async function appendTracks(token, uid, kind, tracks) {
  const info = await playlistInfo(token, uid, kind);
  return addToPlaylist(token, uid, kind, info.revision, tracks, info.count);
}
async function renamePlaylist(token, uid, kind, title) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/name', token, { value: String(title).slice(0, 100) });
}
async function deletePlaylist(token, uid, kind) {
  return apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/delete', token, {});
}
// Убрать треки по id (все вхождения). Удаляем с конца, чтобы номера не сдвигались
async function removeTracks(token, uid, kind, ids) {
  const want = new Set((ids || []).map(String));
  const info = await playlistInfo(token, uid, kind);
  let rev = info.revision, n = 0;
  for (let i = info.items.length - 1; i >= 0; i--) {
    if (!want.has(info.items[i].id)) continue;
    const r = await apiForm('/users/' + encodeURIComponent(uid) + '/playlists/' + encodeURIComponent(kind) + '/change-relative', token,
      { diff: JSON.stringify([{ op: 'delete', from: i, to: i + 1 }]), revision: String(rev) });
    rev = (r && r.revision) || rev + 1; n++;
  }
  return { count: n, revision: rev };
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

module.exports = { artistInfo, CLIENT_ID, setLogger, search, searchTracksPage, suggest, accountStatus, streamUrl, waveStart, waveTracks, waveFeedback, stationsList, stationsDashboard, wavePresets, likedTracks, userPlaylists, playlistTracks, albumTracks, artistTracks, trackById, likedIds, setLike, createPlaylist, addToPlaylist, playlistInfo, appendTracks, renamePlaylist, deletePlaylist, removeTracks };
