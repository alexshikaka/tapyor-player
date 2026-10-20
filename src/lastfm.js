// Last.fm: описание исполнителя, жанровые теги, слушатели, похожие. Ключ — в lastfm.json (кладёт сборка из секрета).
const fs = require('fs');
const path = require('path');
const API = 'https://ws.audioscrobbler.com/2.0/';
function key() {
  for (const p of [path.join(__dirname, 'lastfm.json'), path.join(process.resourcesPath || '', 'lastfm.json')]) {
    try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (j.apiKey) return j.apiKey; } catch (e) {}
  }
  return '';
}
function configured() { return !!key(); }
async function call(method, params) {
  const k = key(); if (!k) throw new Error('нет ключа Last.fm');
  const q = new URLSearchParams(Object.assign({ method, api_key: k, format: 'json' }, params));
  const r = await fetch(API + '?' + q.toString(), { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Tapyor/1.0' } });
  const j = await r.json();
  if (j && j.error) throw new Error('Last.fm ' + j.error + ': ' + (j.message || ''));
  return j;
}
// Текст описания без HTML и без хвоста «Read more on Last.fm»
function cleanBio(s) {
  return String(s || '').replace(/<a [^>]*>[^<]*<\/a>\.?/gi, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
async function artist(name) {
  let j;
  try { j = await call('artist.getinfo', { artist: name, autocorrect: '1', lang: 'ru' }); } catch (e) { throw e; }
  const a = j && j.artist; if (!a) return null;
  let bio = cleanBio(a.bio && a.bio.summary);
  if (bio.length < 40) { // русского описания нет — берём английское
    try { const e2 = await call('artist.getinfo', { artist: name, autocorrect: '1' }); bio = cleanBio(e2.artist && e2.artist.bio && e2.artist.bio.summary) || bio; } catch (e) {}
  }
  const tags = ((a.tags && a.tags.tag) || []).map((t) => t.name).filter(Boolean).slice(0, 6);
  const similar = ((a.similar && a.similar.artist) || []).map((x) => ({ name: x.name, thumb: '' }));
  return { name: a.name, url: a.url, bio, tags, listeners: Number(a.stats && a.stats.listeners) || 0, plays: Number(a.stats && a.stats.playcount) || 0, similar };
}
module.exports = { artist, configured };
