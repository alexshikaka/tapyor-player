// Порядок выдачи поиска: точность совпадения с запросом, доступ к площадке, «для эфира».
// Работает и в окне Тапёра (window.TapRank), и в Node (для проверок).
(function (root) {
  var NOISE = ['official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', '4k', 'mv', 'клип', 'текст', 'music', 'премьера', 'premiere', 'visualizer', 'topic', 'vevo', 'full', 'version', 'remastered', 'remaster', 'original', 'mix', 'официальный', 'видео', 'песни'];
  // Версии, которые обычно не ищут, если не написали явно
  var ODD = [
    ['remix', 'ремикс', 'rmx', 'bootleg', 'edit', 'mashup', 'мэшап'],
    ['cover', 'кавер', 'tribute'],
    ['live', 'лайв', 'концерт', 'concert', 'acoustic', 'акустика', 'unplugged'],
    ['karaoke', 'караоке', 'instrumental', 'минус', 'минусовка', 'backing'],
    ['slowed', 'reverb', 'sped', 'speed', 'nightcore', '8d', 'bass boosted', 'boosted', 'tiktok', 'phonk'],
    ['reaction', 'реакция', 'разбор', 'урок', 'lesson', 'tutorial', 'как играть', 'аккорды', 'chords']
  ];
  var CLIPS = ['official video', 'music video', 'клип', 'official clip', 'video clip'];

  function low(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е'); }
  function norm(s) { return low(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function toks(s) { return norm(s).split(' ').filter(Boolean); }
  function noBrackets(s) { return String(s || '').replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[([{][^)\]}]*$/, ' '); }
  function tm(a, b) { return a === b || (a.length >= 4 && b.length >= 4 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)); }
  function frac(need, have) { if (!need.length) return 0; var n = 0; need.forEach(function (t) { if (have.some(function (h) { return tm(t, h); })) n++; }); return n / need.length; }

  // Имя канала YouTube → имя исполнителя: «Кино - Topic», «KinoVEVO», «Kino Official»
  function cleanChannel(a) {
    return String(a || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s*(official|официальный канал|official channel|music)$/i, '').trim();
  }
  // Исполнитель и название: у YouTube название часто «Исполнитель - Песня»
  function parse(v) {
    var title = String(v.title || ''), author = String(v.author || '');
    var src = v.src || 'yt';
    if (src === 'yt' || src === 'sc') {
      var m = title.match(/^(.{1,80}?)\s+[-–—|]\s+(.+)$/);
      if (m) return { artist: m[1], title: m[2], channel: author };
      return { artist: cleanChannel(author), title: title, channel: author };
    }
    return { artist: author, title: title, channel: author };
  }
  function hasPhrase(text, w) { return (' ' + text + ' ').indexOf(' ' + w + ' ') >= 0; }
  function oddGroups(text) { var out = []; ODD.forEach(function (g, i) { if (g.some(function (w) { return hasPhrase(text, w); })) out.push(i); }); return out; }

  // Точность: 0…100+
  function relevance(q, v) {
    var p = parse(v);
    var qn = norm(q), qt = toks(q);
    if (!qt.length) return 0;
    var tn = norm(noBrackets(p.title)), an = norm(p.artist);
    var tt = toks(noBrackets(p.title)).filter(function (t) { return NOISE.indexOf(t) < 0; });
    var at = toks(p.artist);
    var full = norm(v.title + ' ' + v.author + ' ' + p.artist);
    var allT = toks(full);
    var s = 0;
    // 1. Совпадение названия
    var qNoArtist = qt.filter(function (t) { return !at.some(function (a) { return tm(t, a); }); });
    var qna = qNoArtist.join(' ');
    if (tn && (tn === qn || (qna && tn === qna))) s += 50;
    else if (tn && qna && tn.indexOf(qna) === 0) s += 32;
    else if (tn && qna && (' ' + tn + ' ').indexOf(' ' + qna + ' ') >= 0) s += 22;
    // доля слов запроса, найденных в треке
    s += frac(qt, allT) * 30;
    // доля слов названия, которые есть в запросе (лишние слова в названии — хуже)
    s += frac(tt, qt) * 12;
    // 2. Исполнитель из запроса совпал
    if (at.length && frac(at, qt) >= 0.99) s += 15;
    else if (an && qn.indexOf(an) >= 0) s += 12;
    // 3. Необычные версии, которых нет в запросе
    var raw = norm(v.title), qOdd = oddGroups(qn), odd = oddGroups(raw).filter(function (g) { return qOdd.indexOf(g) < 0; });
    if (odd.length) s -= 22 + 6 * (odd.length - 1);
    // 4. Официальный канал / «Тема» YouTube
    if ((v.src || 'yt') === 'yt') {
      if (/\s-\s*topic$/i.test(v.author || '') || /vevo$/i.test(v.author || '')) s += 4;
      else if (at.length && norm(cleanChannel(v.author)) === an) s += 3;
    }
    return s;
  }
  // Популярность — только чтобы развести равные (0…3)
  function popularity(v) { var n = Number(v.views || v.plays || 0); return n > 0 ? Math.min(3, Math.log10(n) / 3) : 0; }

  // ctx: { ymFull, ymOn, ytOn, ytLogged, scOn, auOn, order:[...] }
  function access(v, ctx) {
    var s = v.src || 'yt';
    if (s === 'ym') return !ctx.ymOn ? 'off' : (v.preview || !ctx.ymFull ? 'preview' : 'full');
    if (s === 'yt') return ctx.ytOn ? 'full' : 'off';
    if (s === 'sc') return !ctx.scOn ? 'off' : (v.preview ? 'preview' : 'full');
    if (s === 'au') return ctx.auOn ? 'full' : 'off';
    return 'full';
  }
  function isPaid(v, ctx) { var s = v.src || 'yt'; return (s === 'ym' && ctx.ymFull) || (s === 'yt' && ctx.ytLogged); }
  function isFree(v) { var s = v.src || 'yt'; return s === 'sc' || s === 'au' || s === 'yt'; }
  function orderPos(v, ctx) { var o = ctx.order || ['ym', 'yt', 'sc', 'au']; var i = o.indexOf(v.src || 'yt'); return i < 0 ? o.length : i; }
  function airPenalty(v) {
    var raw = norm(v.title), sec = Number(v.seconds || 0), p = 0;
    if (sec > 600) p += 30; else if (sec > 0 && sec < 60) p += 25;
    if (CLIPS.some(function (w) { return hasPhrase(raw, w); })) p += 10;
    if (oddGroups(raw).indexOf(2) >= 0) p += 15; // живые записи на эфир — хуже
    return p;
  }

  function score(q, v, mode, ctx) {
    var r = relevance(q, v), acc = access(v, ctx), pos = orderPos(v, ctx);
    var tie = popularity(v) - pos * 0.4;
    if (acc === 'off') return -1000 + r;
    var accB = acc === 'preview' ? -30 : ({ ym: 12, yt: 6, sc: 3, au: 3 }[v.src || 'yt'] || 0);
    switch (mode) {
      case 'exact': return r + tie + (acc === 'preview' ? -5 : 0);
      case 'subs': return (acc === 'preview' ? -200 : (isPaid(v, ctx) ? 200 : 0)) + r + tie;
      case 'free': return (isFree(v) ? 200 : 0) + r + tie + (acc === 'preview' ? -30 : 0);
      case 'air': return r + accB - airPenalty(v) + tie;
      default: return r + accB + tie; // smart
    }
  }

  // Ключ «та же песня» — чтобы склеить одну песню с разных площадок
  function songKey(v) {
    var p = parse(v);
    var t = toks(noBrackets(p.title)).filter(function (x) { return NOISE.indexOf(x) < 0 && x !== 'feat' && x !== 'ft'; }).join(' ');
    var a = toks(p.artist.split(/,|&| feat\.? | ft\.? /i)[0] || '').join(' ');
    if (!t) return '';
    var odd = oddGroups(norm(v.title)).join('.');
    return a + '|' + t + (odd ? '|' + odd : '');
  }

  // Упорядочить список; дубли одной песни — в v.alts у лучшей версии
  function rank(q, list, mode, ctx) {
    var scored = list.map(function (v, i) { return { v: v, s: score(q, v, mode, ctx), i: i }; });
    scored.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    var byKey = {}, out = [];
    scored.forEach(function (x) {
      var k = songKey(x.v);
      if (k && byKey[k]) { var best = byKey[k]; (best.alts = best.alts || []).push(x.v); return; }
      x.v.alts = [];
      x.v._acc = access(x.v, ctx);
      if (k) byKey[k] = x.v;
      out.push(x.v);
    });
    return out;
  }

  // «Баста, Скриптонит feat. Мот» → [{name:'Баста'}, {sep:', '}, …]
  function splitArtists(s) {
    var parts = String(s || '').split(/(\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?|featuring|при уч\.)\s+)/i);
    return parts.map(function (x, i) { return i % 2 ? { sep: x } : { name: x.trim() }; }).filter(function (x) { return x.sep || x.name; });
  }

  var api = { rank: rank, relevance: relevance, score: score, songKey: songKey, parse: parse, splitArtists: splitArtists, cleanChannel: cleanChannel, access: access };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapRank = api;
})(this);
