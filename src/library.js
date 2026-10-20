// Музыка с компьютера: папки, список файлов с тегами, поиск, плейлисты M3U.
// Файлы никуда не загружаются — Тапёр только читает их и играет через свой локальный сервер.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const tags = require('./tags');
const match = require('./match');

let log = () => {};
let dataDir = '';
let folders = [];          // папки библиотеки
let files = new Map();     // путь → запись
let byId = new Map();      // id → путь
let extras = new Set();    // отдельные файлы (перетащили, из M3U) вне папок
let scanning = null;       // { done, total, folder }
let saveT = null;

const MAX_FILES = 60000, MAX_DEPTH = 14;

function idOf(p) { return crypto.createHash('sha1').update(path.resolve(p).toLowerCase()).digest('hex').slice(0, 20); }
function isAudio(p) { return tags.AUDIO_EXT.includes(path.extname(p).toLowerCase()); }
function isPlaylistFile(p) { return /\.(m3u8?|pls)$/i.test(p); }
function indexFile() { return path.join(dataDir, 'library.json'); }

function setup(o) {
  log = o.log || log; dataDir = o.dataDir;
  try {
    const j = JSON.parse(fs.readFileSync(indexFile(), 'utf8'));
    folders = Array.isArray(j.folders) ? j.folders : [];
    (j.extras || []).forEach((p) => extras.add(p));
    for (const [p, r] of Object.entries(j.files || {})) { r.path = p; files.set(p, r); byId.set(r.id, p); }
  } catch (e) { /* первый запуск */ }
}
function saveSoon() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const o = { v: 1, folders, extras: Array.from(extras), files: {} };
    for (const [p, r] of files) { const c = Object.assign({}, r); delete c.path; o.files[p] = c; }
    try { fs.writeFileSync(indexFile(), JSON.stringify(o)); } catch (e) { log('музыка с компьютера: не сохранился список — ' + e.message); }
  }, 800);
}

// «Исполнитель - Название» из имени файла, если тегов нет
function fromName(p) {
  const base = path.basename(p, path.extname(p)).replace(/_/g, ' ').replace(/^\s*\d{1,3}\s*[.\-–—)]\s*/, '').trim();
  const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: '', title: base };
}
function fmtDur(s) { s = Math.round(s || 0); if (!s) return ''; const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; const p = (n) => (n < 10 ? '0' : '') + n; return h ? h + ':' + p(m) + ':' + p(x) : m + ':' + p(x); }
const FOLDER_COVERS = ['cover.jpg', 'cover.png', 'folder.jpg', 'folder.png', 'front.jpg', 'front.png', 'albumart.jpg', 'Cover.jpg', 'Folder.jpg'];
function folderCover(dir) {
  try {
    const list = fs.readdirSync(dir);
    const low = list.map((x) => x.toLowerCase());
    for (const c of FOLDER_COVERS) { const i = low.indexOf(c.toLowerCase()); if (i >= 0) return path.join(dir, list[i]); }
    const any = list.find((x) => /\.(jpe?g|png)$/i.test(x) && /(cover|front|folder|обложка)/i.test(x));
    return any ? path.join(dir, any) : '';
  } catch (e) { return ''; }
}

async function indexOne(p, st) {
  const old = files.get(p);
  if (old && old.mtime === st.mtimeMs && old.size === st.size) return old;
  let t = {};
  try { t = await tags.readTags(p); } catch (e) { log('музыка с компьютера: не прочитал теги ' + path.basename(p) + ' — ' + e.message); }
  const n = fromName(p);
  const r = {
    id: idOf(p), path: p, mtime: st.mtimeMs, size: st.size, added: (old && old.added) || Date.now(),
    title: t.title || n.title, artist: t.artist || n.artist || '', album: t.album || '', albumArtist: t.albumArtist || '',
    year: t.year || 0, track: t.track || 0, seconds: t.seconds || 0, gain: t.gain, cover: t.hasCover ? 'tag' : (folderCover(path.dirname(p)) ? 'dir' : '')
  };
  files.set(p, r); byId.set(r.id, p);
  return r;
}

// Обход папки: только музыка, без скрытых и системных
async function walk(dir, depth, outList) {
  if (depth > MAX_DEPTH || outList.length >= MAX_FILES) return;
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name[0] === '.' || e.name[0] === '$' || /^(System Volume Information|node_modules|\$RECYCLE\.BIN)$/i.test(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, depth + 1, outList);
    else if (e.isFile() && isAudio(p)) outList.push(p);
    if (outList.length >= MAX_FILES) return;
  }
}
function under(p, dir) { const r = path.relative(dir, p); return r && !r.startsWith('..') && !path.isAbsolute(r); }

async function scan(onProgress) {
  if (scanning) return scanning.promise;
  scanning = { done: 0, total: 0 };
  scanning.promise = (async () => {
    const t0 = Date.now();
    const list = [];
    for (const f of folders) await walk(f, 0, list);
    for (const x of extras) if (fs.existsSync(x)) list.push(x);
    scanning.total = list.length;
    const seen = new Set(list);
    let added = 0, k = 0;
    const worker = async () => {
      while (k < list.length) {
        const p = list[k++];
        try { const st = await fs.promises.stat(p); const had = files.has(p); await indexOne(p, st); if (!had) added++; } catch (e) {}
        scanning.done++;
        if (onProgress && scanning.done % 50 === 0) onProgress({ done: scanning.done, total: scanning.total });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    let removed = 0;
    for (const p of Array.from(files.keys())) if (!seen.has(p)) { byId.delete(files.get(p).id); files.delete(p); removed++; }
    saveSoon();
    log('музыка с компьютера: ' + files.size + ' файлов (новых ' + added + ', пропало ' + removed + ') за ' + Math.round((Date.now() - t0) / 100) / 10 + ' с');
    if (onProgress) onProgress({ done: scanning.total, total: scanning.total, finished: true });
    return { count: files.size, added, removed };
  })();
  try { return await scanning.promise; } finally { scanning = null; }
}

function toTrack(r) {
  return {
    src: 'lc', id: r.id, title: r.title, author: r.artist, album: r.album, year: r.year || undefined, trackNo: r.track || undefined,
    duration: fmtDur(r.seconds), seconds: r.seconds || 0, thumb: r.cover ? '/lcover/' + r.id : '',
    // ReplayGain считается от −18 LUFS: громкость трека ≈ −18 − gain
    lufs: typeof r.gain === 'number' ? -18 - r.gain : undefined,
    path: r.path, folder: path.dirname(r.path), ext: path.extname(r.path).slice(1).toLowerCase()
  };
}
function all() { return Array.from(files.values()).map(toTrack); }
function status() {
  const per = folders.map((f) => ({ path: f, count: Array.from(files.keys()).filter((p) => under(p, f)).length }));
  return { folders: per, count: files.size, extras: extras.size, scanning: scanning ? { done: scanning.done, total: scanning.total } : null };
}
function addFolder(dir) {
  dir = path.resolve(dir);
  if (folders.some((f) => f === dir || under(dir, f))) return { already: true };
  folders = folders.filter((f) => !under(f, dir)); // внутренние папки поглощаются
  folders.push(dir); saveSoon();
  log('музыка с компьютера: добавлена папка ' + dir);
  return { ok: true };
}
function removeFolder(dir) { folders = folders.filter((f) => f !== dir); for (const p of Array.from(files.keys())) if (under(p, dir) && !extras.has(p)) { byId.delete(files.get(p).id); files.delete(p); } saveSoon(); return { ok: true }; }
function inLibrary(p) { return folders.some((f) => under(p, f)); }

// Отдельные файлы (перетаскивание, M3U): попадают в список «известных», чтобы играть и сохраняться в плейлистах
async function addFiles(paths) {
  const out = [];
  for (const p0 of paths) {
    const p = path.resolve(p0);
    try {
      const st = await fs.promises.stat(p);
      if (!st.isFile() || !isAudio(p)) continue;
      if (!inLibrary(p)) extras.add(p);
      out.push(toTrack(await indexOne(p, st)));
    } catch (e) {}
  }
  if (out.length) saveSoon();
  return out;
}
// Что перетащили в окно: папки, файлы музыки, плейлисты
async function classify(paths) {
  const r = { folders: [], audio: [], playlists: [], other: 0 };
  for (const p of paths) {
    try {
      const st = await fs.promises.stat(p);
      if (st.isDirectory()) r.folders.push(p);
      else if (isAudio(p)) r.audio.push(p);
      else if (isPlaylistFile(p)) r.playlists.push(p);
      else r.other++;
    } catch (e) { r.other++; }
  }
  return r;
}
// Файлы одной папки (без добавления в библиотеку) — «сыграть папку»
async function folderTracks(dir) {
  const list = []; await walk(dir, 0, list);
  return addFiles(list.slice(0, 3000));
}

function pathOf(id) { return byId.get(id) || ''; }
async function cover(id) {
  const p = byId.get(id); if (!p) return null;
  const r = files.get(p);
  if (r && r.cover === 'tag') { try { const c = await tags.readCover(p); if (c) return c; } catch (e) {} }
  const f = folderCover(path.dirname(p));
  if (f) { try { return { mime: /png$/i.test(f) ? 'image/png' : 'image/jpeg', data: await fs.promises.readFile(f) }; } catch (e) {} }
  return null;
}

// Поиск по своим файлам: все слова запроса должны найтись в исполнителе/названии/альбоме/имени файла
function search(q, limit) {
  const qt = match.tokens(q); if (!qt.length) return [];
  const tm = (a, b) => a === b || (a.length >= 3 && b.startsWith(a));
  const out = [];
  for (const r of files.values()) {
    const tt = match.tokens(r.title), at = match.tokens(r.artist + ' ' + r.albumArtist), al = match.tokens(r.album), fn = match.tokens(path.basename(r.path, path.extname(r.path)));
    const hay = tt.concat(at, al, fn);
    let hit = 0; for (const t of qt) if (hay.some((h) => tm(t, h))) hit++;
    if (hit < qt.length) continue;
    let s = 0; for (const t of qt) { if (tt.some((h) => tm(t, h))) s += 2; if (at.some((h) => tm(t, h))) s += 1.5; }
    if (match.norm(r.title) === match.norm(q)) s += 4;
    out.push({ r, s });
  }
  out.sort((a, b) => b.s - a.s);
  return out.slice(0, limit || 40).map((x) => toTrack(x.r));
}

// --- M3U / PLS ---
function parsePlaylistText(text, baseDir) {
  const items = [];
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  if (/^\s*\[playlist\]/i.test(lines[0] || '')) { // PLS
    const f = {}, t = {}, l = {};
    lines.forEach((x) => { const m = /^(File|Title|Length)(\d+)=(.*)$/i.exec(x.trim()); if (!m) return; ({ file: f, title: t, length: l })[m[1].toLowerCase()][m[2]] = m[3]; });
    Object.keys(f).sort((a, b) => a - b).forEach((k) => items.push({ loc: f[k], title: t[k] || '', seconds: parseInt(l[k], 10) > 0 ? +l[k] : 0 }));
  } else {
    let inf = null;
    for (const raw of lines) {
      const x = raw.trim(); if (!x) continue;
      if (/^#EXTINF:/i.test(x)) { const m = /^#EXTINF:\s*(-?\d+)[^,]*,(.*)$/i.exec(x); inf = m ? { seconds: Math.max(0, +m[1]), title: m[2].trim() } : null; continue; }
      if (x[0] === '#') continue;
      items.push({ loc: x, title: inf ? inf.title : '', seconds: inf ? inf.seconds : 0 }); inf = null;
    }
  }
  return items.map((it) => {
    let loc = it.loc;
    if (/^file:\/\//i.test(loc)) { try { loc = decodeURIComponent(new URL(loc).pathname).replace(/^\/([A-Za-z]:)/, '$1'); } catch (e) {} }
    const isUrl = /^https?:\/\//i.test(loc);
    const abs = isUrl ? '' : (path.isAbsolute(loc) ? loc : path.join(baseDir || '', loc));
    return { url: isUrl ? loc : '', file: abs, line: it.title || (isUrl ? '' : path.basename(abs, path.extname(abs)).replace(/_/g, ' ')), seconds: it.seconds };
  });
}
async function readPlaylistFile(p) {
  const buf = await fs.promises.readFile(p);
  let text = buf.toString('utf8');
  if (text.includes('�') && !/\.m3u8$/i.test(p)) { try { text = new TextDecoder('windows-1251').decode(buf); } catch (e) {} }
  const items = parsePlaylistText(text, path.dirname(p));
  const files0 = items.filter((x) => x.file && fs.existsSync(x.file) && isAudio(x.file)).map((x) => x.file);
  const tracks = await addFiles(files0);
  const byPath = new Map(tracks.map((t) => [path.resolve(t.path), t]));
  return { title: path.basename(p, path.extname(p)), items: items.map((x) => Object.assign(x, { track: x.file ? byPath.get(path.resolve(x.file)) || null : null })) };
}
function trackUrl(t) {
  if (t.src === 'ym') return 'https://music.yandex.ru/' + (t.albumId ? 'album/' + t.albumId + '/' : '') + 'track/' + t.id;
  if (t.src === 'yt') return 'https://www.youtube.com/watch?v=' + t.id;
  if (t.src === 'au') return 'https://audius.co/tracks/' + t.id;
  if (/^https?:/.test(t.id || '')) return t.id;
  return '';
}
function m3uText(title, tracks) {
  const out = ['#EXTM3U', '#PLAYLIST:' + String(title || '').replace(/[\r\n]/g, ' ')];
  for (const t of tracks || []) {
    const loc = t.src === 'lc' ? (pathOf(t.id) || t.path || '') : trackUrl(t);
    if (!loc) continue;
    out.push('#EXTINF:' + (t.seconds || -1) + ',' + ((t.author ? t.author + ' - ' : '') + (t.title || '')).replace(/[\r\n]/g, ' '));
    out.push(loc);
  }
  return out.join('\r\n') + '\r\n';
}

module.exports = { setup, scan, all, status, addFolder, removeFolder, addFiles, classify, folderTracks, pathOf, cover, search, parsePlaylistText, readPlaylistFile, m3uText, trackUrl, isAudio, isPlaylistFile, idOf, toTrack, _files: files };
