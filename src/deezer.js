// Deezer: открытый справочник музыки (без ключа) — дискография исполнителя и треклисты альбомов.
// Слушать через Deezer Тапёр не умеет: найденные песни ищутся на площадках, где есть доступ.
const API = 'https://api.deezer.com';
async function get(p) {
  const r = await fetch(API + p, { signal: AbortSignal.timeout(10000), headers: { 'Accept-Language': 'ru' } });
  const j = await r.json();
  if (j && j.error) throw new Error((j.error.type || 'Deezer') + ': ' + (j.error.message || ''));
  return j;
}
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function fmt(sec) { sec = Math.round(sec || 0); return sec ? Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') : ''; }
function mapAlbum(a) {
  const t = a.record_type === 'single' || a.record_type === 'ep' ? 'single' : (a.record_type === 'compile' ? 'compilation' : 'album');
  return { src: 'dz', id: String(a.id), title: a.title || '', year: a.release_date ? Number(String(a.release_date).slice(0, 4)) : 0, type: t, thumb: a.cover_medium || a.cover || '', count: a.nb_tracks || 0 };
}
function mapTrack(t, albumTitle) {
  return { src: 'dz', id: String(t.id), title: t.title || '', author: (t.artist && t.artist.name) || '', album: albumTitle || (t.album && t.album.title) || '', seconds: t.duration || 0, duration: fmt(t.duration), thumb: (t.album && t.album.cover_medium) || '' };
}
// Найти исполнителя по имени: точное совпадение имени, иначе самый популярный из первых
async function findArtist(name) {
  const r = await get('/search/artist?limit=10&q=' + encodeURIComponent(name));
  const list = (r && r.data) || [];
  const n = norm(name);
  return list.find((a) => norm(a.name) === n) || list.find((a) => norm(a.name).startsWith(n) || n.startsWith(norm(a.name))) || null;
}
async function artistPage(name) {
  const a = await findArtist(name);
  if (!a) return null;
  const id = a.id;
  const [info, albums, top, rel] = await Promise.all([
    get('/artist/' + id).catch(() => a),
    get('/artist/' + id + '/albums?limit=200').catch(() => ({ data: [] })),
    get('/artist/' + id + '/top?limit=20').catch(() => ({ data: [] })),
    get('/artist/' + id + '/related?limit=16').catch(() => ({ data: [] }))
  ]);
  return {
    id: String(id), name: info.name || a.name, photo: info.picture_xl || info.picture_big || '', fans: info.nb_fan || 0,
    albums: (albums.data || []).map(mapAlbum),
    top: (top.data || []).map((t) => mapTrack(t)),
    similar: (rel.data || []).map((x) => ({ name: x.name, thumb: x.picture_medium || '', fans: x.nb_fan || 0 }))
  };
}
async function album(id) {
  const a = await get('/album/' + encodeURIComponent(id));
  const tracks = ((a.tracks && a.tracks.data) || []).map((t) => mapTrack(t, a.title));
  return { src: 'dz', id: String(a.id), title: a.title || '', author: (a.artist && a.artist.name) || '', year: a.release_date ? Number(String(a.release_date).slice(0, 4)) : 0, thumb: a.cover_medium || '', tracks };
}
module.exports = { artistPage, album, norm };
