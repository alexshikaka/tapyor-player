// Разбор строки «Исполнитель — Название» из текста и выбор лучшего найденного трека
const STOP = new Set(['the', 'a', 'an', 'и', 'feat', 'ft', 'featuring', 'ost', 'official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', 'клип', 'текст', 'music', 'mv']);

function norm(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е')
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')   // всё в скобках
    .replace(/[([{][^)\]}]*$/, ' ')          // незакрытая скобка в конце
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
function tokens(s) { return norm(s).split(' ').filter((t) => t && !STOP.has(t)); }

// Чистка строки: мусорные [www…], #хэштеги, «-----», номера в начале, подчёркивания
function clean(line) {
  let s = String(line || '')
    .replace(/\[[^\]]*(www\.|https?:|\.com|\.ru|\.ua|\.net|\+text)[^\]]*\]/gi, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s-{3,}.*$/, ' ')
    .replace(/^\s*\d{1,3}([.:]\d{1,3})?\s*[.)\-–—]\s+/, '')
    .replace(/\s+/g, ' ').trim();
  const query = s
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[([{][^)\]}]*$/, ' ')
    .replace(/\s+[-–—]\s+/g, ' ')
    .replace(/[\\/|()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!/[\p{L}\p{N}]/u.test(query)) return { line, display: s, query: '', toks: [] };
  return { line, display: s, query, toks: tokens(query) };
}

function tokMatch(a, b) { return a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))); }
function frac(need, have) {
  if (!need.length) return 0;
  return need.filter((t) => have.some((h) => tokMatch(t, h))).length / need.length;
}

function scoreYm(q, c) {
  const tt = tokens(c.title), at = tokens(c.author), all = tt.concat(at);
  const tFrac = frac(tt, q.toks), aFrac = frac(at, q.toks), cover = frac(q.toks, all);
  return { t: c, tFrac, aFrac, cover, s: tFrac * 2 + aFrac + cover,
    exact: tFrac === 1 && aFrac >= 0.99 && cover >= 0.6,
    close: tFrac >= 0.5 && (aFrac > 0 || cover >= 0.5) };
}
function scoreYt(q, c) {
  const all = tokens(c.title + ' ' + c.author);
  return { t: c, cover: frac(q.toks, all) };
}

// ym, yt — найденные кандидаты (уже в формате треков Тапёра)
function decide(q, ym, yt) {
  const ys = (ym || []).map((c) => scoreYm(q, c)).sort((a, b) => b.s - a.s);
  const ts = (yt || []).map((c) => scoreYt(q, c)).sort((a, b) => b.cover - a.cover);
  const bY = ys[0], bT = ts[0];
  let status = 'none', track = null;
  if (bY && bY.exact) { status = 'exact'; track = bY.t; }
  else if (bT && bT.cover >= 0.99 && q.toks.length >= 2 && !(bY && bY.close)) { status = 'exact'; track = bT.t; }
  else if (bY && bY.close && (!bT || bY.s >= bT.cover * 3 - 0.5)) { status = 'close'; track = bY.t; }
  else if (bT && bT.cover >= 0.6) { status = 'close'; track = bT.t; }
  else if (bY && bY.close) { status = 'close'; track = bY.t; }
  const alts = ys.slice(0, 5).map((x) => x.t).concat(ts.slice(0, 4).map((x) => x.t)).filter((t) => t !== track);
  return { status, track, alts };
}

// Подсказка по длительности (из глав видео, M3U, CSV): берём версию той же длины, а не 10-минутный лайв
function preferDuration(r, sec) {
  if (!sec || sec < 20 || !r || !r.track) return r;
  const tol = (s) => Math.max(12, s * 0.12);
  const off = (t) => (t && t.seconds ? Math.abs(t.seconds - sec) : 0);
  if (!r.track.seconds || off(r.track) <= tol(sec)) return r;
  const tt = tokens(r.track.title);
  const same = (t) => { const x = tokens(t.title); return frac(tt, x) >= 0.99 || frac(x, tt) >= 0.99; };
  const alt = (r.alts || []).find((t) => t.seconds && off(t) <= tol(sec) && same(t));
  if (alt) return Object.assign({}, r, { track: alt, alts: [r.track].concat(r.alts.filter((t) => t !== alt)), durFixed: true });
  if (r.status === 'exact' && off(r.track) > Math.max(40, sec * 0.35)) return Object.assign({}, r, { status: 'close', durWarn: true });
  return r;
}
// Свои файлы: та же проверка, что для Яндекса (название и исполнитель совпали)
function exactLocal(q, list) {
  const s = (list || []).map((c) => scoreYm(q, c)).sort((a, b) => b.s - a.s);
  return s[0] && s[0].exact ? s[0].t : null;
}
// Только одна площадка (для переноса плейлиста на неё)
function decideOnly(q, list, kind) { return kind === 'yt' ? decide(q, [], list) : decide(q, list, []); }

module.exports = { clean, decide, decideOnly, tokens, norm, preferDuration, exactLocal };
