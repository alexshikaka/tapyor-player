// Источники для мастера «Импорт»: из чего достать список песен «Исполнитель — Название».
// Каждая функция возвращает { title, items: [{ line, seconds? , url? }], note? }.
// Здесь только разбор — сетевые запросы делает main.js (fetchText передаётся снаружи).

const MUSIC_LINK = /https?:\/\/(?:www\.|m\.)?(?:music\.yandex\.(?:ru|com|by|kz|uz)\/\S+|(?:music\.)?youtube\.com\/(?:watch|playlist|shorts)\S*|youtu\.be\/\S+|soundcloud\.com\/\S+|on\.soundcloud\.com\/\S+|[\w-]+\.bandcamp\.com\/\S+|open\.spotify\.com\/\S+|music\.apple\.com\/\S+|(?:www\.)?deezer\.com\/\S+)/gi;

function decodeEntities(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
}
function hasLetters(s) { return /[\p{L}\p{N}]/u.test(s || ''); }
const TS = /^\s*[[(]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[\])]?\s*[-–—.:|)]*\s*/;
function tsSec(t) { return String(t).split(':').reduce((a, x) => a * 60 + (+x || 0), 0); }
function fmtSec(s) { s = Math.round(s); const m = Math.floor(s / 60), x = s % 60; return m + ':' + (x < 10 ? '0' : '') + x; }

// Строка текста похожа на песню? (а не на «подписывайтесь», «ссылки ниже» и т.п.)
const JUNK = /(подпис|subscribe|донат|donat|instagram|инстаграм|vk\.com|t\.me\/|patreon|boosty|реклам|промокод|спасибо|thanks for|follow|соцсет|мерч|merch|tickets|билеты|куплет|припев|chorus|verse|intro\b|outro\b|^tracklist|^треклист|^список треков|^plays?list|^\d+\s*(k|тыс)|https?:)/i;
function songish(s) {
  s = String(s || '').trim();
  if (!hasLetters(s) || s.length < 3 || s.length > 160) return false;
  if (JUNK.test(s)) return false;
  return true;
}

// Обычный текст: строки + ссылки на музыку в нём
function fromText(text) {
  const items = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const l = raw.trim(); if (!l) return;
    const links = l.match(MUSIC_LINK);
    if (links) { links.forEach((u) => items.push({ url: u.replace(/[),.;!?»"']+$/, ''), line: '' })); const rest = l.replace(MUSIC_LINK, '').trim(); if (songish(rest) && /[-–—]/.test(rest)) items.push({ line: rest }); return; }
    if (hasLetters(l)) items.push({ line: l });
  });
  return { items };
}

// Видео YouTube: главы → описание с таймкодами → нумерованный список в описании
function fromYoutubeInfo(j) {
  const title = j.title || 'Видео YouTube';
  const dur = j.duration || 0;
  const chapters = (j.chapters || []).filter((c) => c && songish(c.title) && !/^(intro|outro|вступление|начало|конец|<untitled chapter \d+>)$/i.test(String(c.title).trim()));
  if (chapters.length >= 2) {
    return { title, kind: 'chapters', items: chapters.map((c) => ({ line: String(c.title).trim(), at: c.start_time || 0, seconds: Math.round((c.end_time || dur) - (c.start_time || 0)) })) };
  }
  const desc = String(j.description || '').split(/\r?\n/);
  const ts = [];
  desc.forEach((l) => {
    let m = TS.exec(l), t, rest;
    if (m) { t = tsSec(m[1]); rest = l.slice(m[0].length); }
    else { const m2 = /^(.*?)\s*[-–—|(\[]?\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[)\]]?\s*$/.exec(l); if (m2 && m2[1].trim()) { t = tsSec(m2[2]); rest = m2[1]; } }
    if (t == null) return;
    rest = String(rest).replace(/^\s*\d{1,3}[.)]\s+/, '').trim();
    if (songish(rest)) ts.push({ line: rest, at: t });
  });
  if (ts.length >= 2) {
    ts.sort((a, b) => a.at - b.at);
    ts.forEach((x, i) => { const end = i + 1 < ts.length ? ts[i + 1].at : dur; if (end > x.at) x.seconds = Math.round(end - x.at); });
    return { title, kind: 'timestamps', items: ts };
  }
  const num = desc.map((l) => /^\s*\d{1,3}\s*[.)]\s+(.+?[-–—].+)$/.exec(l)).filter(Boolean).map((m) => ({ line: m[1].trim() })).filter((x) => songish(x.line));
  if (num.length >= 2) return { title, kind: 'list', items: num };
  // Описание со строками «Исполнитель — Название»
  const dash = desc.map((l) => l.trim()).filter((l) => /^[^-–—]{2,60}\s[-–—]\s[^-–—]{2,90}$/.test(l) && songish(l)).map((l) => ({ line: l }));
  if (dash.length >= 3) return { title, kind: 'list', items: dash };
  return { title, kind: 'none', items: [], note: 'В этом видео нет глав и списка песен в описании.' };
}

// Telegram Desktop → «Экспорт истории чата» → JSON (result.json)
function fromTelegramJson(text) {
  let j; try { j = JSON.parse(String(text).replace(/^﻿/, '')); } catch (e) { return null; }
  const msgs = j.messages || (j.chats && j.chats.list && [].concat.apply([], j.chats.list.map((c) => c.messages || []))) || [];
  if (!Array.isArray(msgs)) return null;
  const items = [];
  msgs.forEach((m) => {
    if (!m || m.type !== 'message') return;
    if (m.media_type === 'audio_file' || (m.mime_type && /^audio\//.test(m.mime_type))) {
      const perf = m.performer || '', t = m.title || '';
      const name = (perf && t) ? perf + ' — ' + t : (t || String(m.file_name || m.file || '').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]{2,4}$/i, '').replace(/_/g, ' '));
      if (hasLetters(name) && !/^\(File not included/i.test(name)) items.push({ line: name, seconds: m.duration_seconds || 0 });
      return;
    }
    const txt = Array.isArray(m.text) ? m.text.map((x) => (typeof x === 'string' ? x : (x.href || x.text || ''))).join('') : String(m.text || '');
    (txt.match(MUSIC_LINK) || []).forEach((u) => items.push({ url: u.replace(/[),.;!?»"']+$/, ''), line: '' }));
    txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[^-–—]{2,60}\s[-–—]\s[^-–—]{2,90}$/.test(l) && songish(l)).forEach((l) => items.push({ line: l }));
  });
  return { title: j.name || 'Из Telegram', items };
}
// Экспорт в HTML (messages.html, messages2.html …)
function fromTelegramHtml(html) {
  const h = String(html || '');
  const items = [];
  const title = decodeEntities((/<div class="text bold">\s*([\s\S]*?)\s*<\/div>/.exec(h) || [])[1] || '').trim() || 'Из Telegram';
  // аудио: <div class="media_audio_file"> … <div class="title bold">Название</div> <div class="status details">Исполнитель</div>
  const re = /class="media[^"]*(?:media_audio_file|media_voice_message|media_file)[^"]*"[\s\S]*?<div class="title bold">([\s\S]*?)<\/div>\s*(?:<div class="status details">([\s\S]*?)<\/div>)?/g;
  let m;
  while ((m = re.exec(h))) {
    const t = decodeEntities(m[1]).trim(), perf = decodeEntities(m[2] || '').trim();
    if (!hasLetters(t) || /^\d+(:\d+)+/.test(perf) && !t) continue;
    const performer = /^(\d+(:\d+)+|[\d.,]+\s*(KB|MB|ГБ|МБ|КБ))/i.test(perf) ? '' : perf;
    items.push({ line: performer ? performer + ' — ' + t : t });
  }
  const tre = /<div class="text">([\s\S]*?)<\/div>/g;
  while ((m = tre.exec(h))) {
    const raw = m[1];
    (raw.match(/href="([^"]+)"/g) || []).map((x) => x.slice(6, -1)).filter((u) => { MUSIC_LINK.lastIndex = 0; return MUSIC_LINK.test(u); }).forEach((u) => items.push({ url: decodeEntities(u), line: '' }));
    decodeEntities(raw).split(/\n/).map((l) => l.trim()).filter((l) => /^[^-–—]{2,60}\s[-–—]\s[^-–—]{2,90}$/.test(l) && songish(l)).forEach((l) => items.push({ line: l }));
  }
  MUSIC_LINK.lastIndex = 0;
  return { title, items };
}

// CSV: Exportify (Spotify), TuneMyMusic, Soundiiz и любые таблицы с колонками «исполнитель» и «название»
function csvRows(text) {
  const s = String(text || '').replace(/^﻿/, '');
  const first = s.split(/\r?\n/)[0] || '';
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : (first.includes('\t') ? '\t' : ',');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
function fromCsv(text) {
  const rows = csvRows(text);
  if (rows.length < 2) return null;
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const find = (re) => head.findIndex((h) => re.test(h));
  const ti = find(/^(track ?name|title|song|track|название|песня|трек|name)$/);
  const ai = find(/^(artist ?name\(s\)|artist ?names?|artists?|исполнител[ьи]|артист|band|группа)$/);
  const di = find(/^(duration|duration \(ms\)|track duration \(ms\)|длительность|length|time)$/);
  const al = find(/^(album ?name|album|альбом)$/);
  if (ti < 0) return null;
  const items = rows.slice(1).map((r) => {
    const t = (r[ti] || '').trim(), a = ai >= 0 ? (r[ai] || '').trim().replace(/\s*;\s*/g, ', ') : '';
    let sec = 0;
    if (di >= 0) { const v = (r[di] || '').trim(); sec = /:/.test(v) ? tsSec(v) : (+v > 10000 ? Math.round(+v / 1000) : +v || 0); }
    return { line: a ? a + ' — ' + t : t, seconds: sec, album: al >= 0 ? (r[al] || '').trim() : '' };
  }).filter((x) => hasLetters(x.line));
  return { items };
}

// Spotify: страница «встраивания» отдаёт список треков без входа (__NEXT_DATA__)
function fromSpotifyEmbed(html) {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return null;
  let j; try { j = JSON.parse(m[1]); } catch (e) { return null; }
  const ent = j && j.props && j.props.pageProps && j.props.pageProps.state && j.props.pageProps.state.data && j.props.pageProps.state.data.entity;
  if (!ent) return null;
  const list = ent.trackList || (ent.type === 'track' ? [{ title: ent.name || ent.title, subtitle: (ent.artists || []).map((a) => a.name).join(', '), duration: ent.duration }] : []);
  const items = list.map((t) => ({ line: (t.subtitle ? String(t.subtitle).replace(/ /g, ' ') + ' — ' : '') + (t.title || ''), seconds: t.duration ? Math.round(t.duration / 1000) : 0 })).filter((x) => hasLetters(x.line));
  return { title: ent.name || ent.title || 'Плейлист Spotify', items };
}
// Deezer: открытый API (без ключа)
function fromDeezerJson(j) {
  const data = (j && j.tracks && j.tracks.data) || (j && j.data) || [];
  return { title: (j && j.title) || 'Плейлист Deezer', items: data.map((t) => ({ line: ((t.artist && t.artist.name) ? t.artist.name + ' — ' : '') + (t.title || ''), seconds: t.duration || 0 })).filter((x) => hasLetters(x.line)) };
}
// Apple Music: данные страницы (serialized-server-data или ld+json)
function fromAppleHtml(html) {
  const h = String(html || '');
  const items = [];
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 30) return;
    if (Array.isArray(o)) { o.forEach((x) => walk(x, depth + 1)); return; }
    if (typeof o.title === 'string' && typeof o.artistName === 'string' && (o.duration || o.durationInMillis || o.contentDescriptor || o.trackNumber)) {
      items.push({ line: o.artistName + ' — ' + o.title, seconds: Math.round((o.duration || o.durationInMillis || 0) / 1000) });
      return;
    }
    for (const k in o) walk(o[k], depth + 1);
  };
  const sd = /<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/.exec(h);
  if (sd) { try { walk(JSON.parse(sd[1]), 0); } catch (e) {} }
  if (!items.length) {
    const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g; let m;
    while ((m = re.exec(h))) {
      try {
        const j = JSON.parse(m[1]);
        const tr = (j.track && (j.track.itemListElement || j.track)) || [];
        [].concat(tr).forEach((t) => { const x = t.item || t; if (x && x.name) items.push({ line: (x.byArtist ? [].concat(x.byArtist).map((a) => a.name).join(', ') + ' — ' : '') + x.name }); });
      } catch (e) {}
    }
  }
  const seen = new Set();
  const title = decodeEntities((/<meta property="og:title" content="([^"]*)"/.exec(h) || [])[1] || '') || 'Плейлист Apple Music';
  return { title, items: items.filter((x) => { const k = x.line.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }) };
}
// Открытый канал Telegram: страница t.me/s/<канал> (без входа)
function fromTmeChannel(html) {
  const h = String(html || '');
  const items = [];
  const posts = h.split('tgme_widget_message_wrap').slice(1);
  let oldest = 0;
  posts.forEach((p) => {
    const id = /data-post="[^"/]+\/(\d+)"/.exec(p); if (id) { const n = +id[1]; if (!oldest || n < oldest) oldest = n; }
    // аудио: заголовок файла + исполнитель
    const re = /tgme_widget_message_document_title[^>]*>([\s\S]*?)<\/div>\s*<div class="tgme_widget_message_document_extra[^>]*>([\s\S]*?)<\/div>/g; let m;
    while ((m = re.exec(p))) {
      const t = decodeEntities(m[1]).trim(), x = decodeEntities(m[2]).trim();
      const perf = /^[\d.,]+\s*(KB|MB|GB|КБ|МБ|ГБ)$|^\d+:\d+/.test(x) ? '' : x.replace(/\s*[·•]\s*\d+:\d+.*$/, '');
      if (hasLetters(t)) items.push({ line: perf ? perf + ' — ' + t : t });
    }
    const tm = /tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/.exec(p);
    if (tm) {
      (tm[1].match(/href="([^"]+)"/g) || []).map((x) => decodeEntities(x.slice(6, -1))).filter((u) => { MUSIC_LINK.lastIndex = 0; return MUSIC_LINK.test(u); }).forEach((u) => items.push({ url: u, line: '' }));
      decodeEntities(tm[1]).split(/\n/).map((l) => l.trim()).filter((l) => /^[^-–—]{2,60}\s[-–—]\s[^-–—]{2,90}$/.test(l) && songish(l)).forEach((l) => items.push({ line: l }));
    }
  });
  MUSIC_LINK.lastIndex = 0;
  const title = decodeEntities((/<meta property="og:title" content="([^"]*)"/.exec(h) || [])[1] || '') || 'Канал Telegram';
  return { title, items, oldest };
}

// Повторы строк (одна песня в чате несколько раз) — оставляем первую
function dedupeItems(items) {
  const seen = new Set();
  return items.filter((x) => { const k = (x.url || x.line || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}:/.]+/gu, ' ').trim(); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

module.exports = { MUSIC_LINK, fromText, fromYoutubeInfo, fromTelegramJson, fromTelegramHtml, fromCsv, fromSpotifyEmbed, fromDeezerJson, fromAppleHtml, fromTmeChannel, dedupeItems, songish, fmtSec, tsSec };
