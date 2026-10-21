// Заказы со стрима: поиск песен в сообщениях донатов.
// Песня «точно» найдена, только если и исполнитель, и название найденного трека есть в тексте сообщения.
// Сообщения без тире, ссылки и слов про музыку не ищем вовсе — на стримах большинство донатов не про песни
// (у владельца это заказы кораблей: «Выкати Исакова и Москву» не должно превращаться в песню «Москва»).
// Работает в Node (main.js и проверки). Поиск треков делает вызывающий: plan() → запросы, judge() → вердикт.
(function (root) {
  'use strict';
  var STOP = { the: 1, a: 1, an: 1, feat: 1, ft: 1, featuring: 1, ost: 1, official: 1, video: 1, audio: 1, lyrics: 1, lyric: 1, hd: 1, hq: 1, 'клип': 1, music: 1, mv: 1, 'и': 1, '&': 1, x: 1, vs: 1 };
  // Слова-просьбы и вежливость — выкидываем из поискового запроса
  var FILLER = ['поставь', 'поставьте', 'поставить', 'включи', 'включите', 'врубай', 'вруби', 'запусти', 'пожалуйста', 'пожалуста', 'плиз', 'пж', 'пжл', 'плз', 'please', 'pls', 'plz', 'песню', 'песня', 'песни', 'трек', 'трека', 'треки', 'музыку', 'музыка', 'музыки', 'музон', 'song', 'track', 'play', 'привет', 'приветик', 'хай', 'ку', 'всем', 'давай', 'можно', 'хочу', 'заказываю', 'заказ', 'от', 'для', 'тебя', 'меня', 'нас', 'спасибо', 'немного', 'что', 'нибудь', 'нить', 'то', 'какую', 'нибуть', 'еще', 'ещё', 'тоже', 'плиииз', 'бро', 'брат', 'стрим', 'стрима', 'чат', 'чату'];
  // Слова, по которым понятно, что просят музыку (без них и без тире/ссылки сообщение не ищем)
  var MUSIC_RX = /(песн|трек|музык|музон|мелоди|клип|song|track|music|♪|🎵|🎶|(?:^|[^\p{L}])(?:поставь|поставьте|включи|врубай|вруби|запусти|!sr|sr)(?![\p{L}]))/iu;
  var URL_RX = /(https?:\/\/[^\s<>"']+|(?:www\.)?(?:youtu\.be|youtube\.com|music\.youtube\.com|music\.yandex\.(?:ru|com|by|kz)|vk\.com|vk\.ru|soundcloud\.com|on\.soundcloud\.com|t\.me|open\.spotify\.com|[a-z0-9-]+\.bandcamp\.com)\/[^\s<>"']*)/gi;
  // Латиница и кириллица, которые выглядят одинаково (Erа с русской «а» → Era)
  var CYR2LAT = { 'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X' };
  var LAT2CYR = {}; Object.keys(CYR2LAT).forEach(function (k) { if (!LAT2CYR[CYR2LAT[k]]) LAT2CYR[CYR2LAT[k]] = k; });

  function fixMixedWord(w) {
    var lat = (w.match(/[a-z]/gi) || []).length, cyr = (w.match(/[а-яё]/gi) || []).length;
    if (!lat || !cyr) return w;
    var map = lat >= cyr ? CYR2LAT : LAT2CYR;
    return w.split('').map(function (ch) { return map[ch] || ch; }).join('');
  }
  // Подготовка текста: склейки «ШутКороль» → «Шут Король», смешанные буквы, звёздочки цензуры, эмодзи
  function prep(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/([а-яё])([А-ЯЁ])/g, '$1 $2')
      .replace(/([a-z])([A-Z][a-z])/g, '$1 $2')
      .replace(/[\p{L}\p{N}]+/gu, fixMixedWord)
      .replace(/[\u{1F000}-\u{1FAFF}☀-➿]/gu, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }
  function norm(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е')
      .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function normAll(s) { return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  function tokens(s) { return norm(s).split(' ').filter(function (t) { return t && !STOP[t]; }); }
  function lev1(a, b) { // расстояние правки не больше 1
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, d = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++d > 1) return false;
      if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
    }
    return d + (a.length - i) + (b.length - j) <= 1;
  }
  // Слово совпадает с учётом окончаний («кукушку» ≈ «кукушка») и одной опечатки в длинных словах
  function tokEq(a, b) {
    if (a === b) return true;
    var n = Math.min(a.length, b.length);
    if (n >= 4) { var p = 0; while (p < n && a[p] === b[p]) p++; if (p >= Math.max(4, Math.max(a.length, b.length) - 2)) return true; }
    if (Math.max(a.length, b.length) >= 5 && lev1(a, b)) return true;
    return false;
  }
  function frac(need, have) {
    if (!need.length) return 0;
    var k = 0; need.forEach(function (t) { if (have.some(function (h) { return tokEq(t, h); })) k++; });
    return k / need.length;
  }
  function isFiller(w) { return FILLER.indexOf(w) >= 0; }

  // Тире между словами: « - », « — », «- », «-» между буквами («Madk1d-Martin»). Не «BB-67», не «х-90».
  var DASH_RX = /([\p{L}\p{N}'’?!.)»"]) ?[-–—]{1,2} ?(?=[\p{L}«"(])|([\p{L}\p{N}]) [-–—]{1,2}(?=[\p{L}\p{N}«"(])/gu;

  function splitChunks(text) {
    // по строкам, «;», «+», «/» и запятой — если в каждом куске своё тире
    var parts = text.split(/\n|;|\s\+\s|\s\/\s/);
    var out = [];
    parts.forEach(function (p) {
      var commas = p.split(/,\s*/);
      var dashed = commas.filter(function (c) { DASH_RX.lastIndex = 0; return DASH_RX.test(c); });
      if (commas.length > 1 && dashed.length >= 2) out.push.apply(out, commas); else out.push(p);
    });
    return out.map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function lastWords(s, n) { var w = s.split(' ').filter(Boolean); return w.slice(Math.max(0, w.length - n)).join(' '); }
  function firstWords(s, n) { return s.split(' ').filter(Boolean).slice(0, n).join(' '); }
  function clip(s) { return s.replace(/[([{][^)\]}]*[)\]}]/g, ' ').replace(/[«»"“”]/g, ' ').replace(/\s+/g, ' ').trim(); }
  // «Король и Шут Король и Шут» (склейка при копировании) → «Король и Шут»
  function dedupe(s) { var w = s.split(' '); var h = w.length / 2; if (w.length >= 2 && w.length % 2 === 0 && w.slice(0, h).join(' ').toLowerCase() === w.slice(h).join(' ').toLowerCase()) return w.slice(0, h).join(' '); return s; }
  function dropFiller(s) { return s.split(' ').filter(function (w) { return w && !isFiller(normAll(w)); }).join(' '); }

  // Из одного куска с тире — запросы для поиска (с разной обрезкой лишнего слева и справа)
  function dashQueries(chunk) {
    var m, out = [];
    DASH_RX.lastIndex = 0;
    while ((m = DASH_RX.exec(chunk))) {
      var cut = m.index + (m[1] || m[2] || '').length;
      var left = chunk.slice(0, cut), right = chunk.slice(m.index + m[0].length);
      // слева — после последней точки/восклицания/вопроса; справа — до конца предложения
      left = left.split(/[.!?…:]+/).pop();
      right = right.split(/[.!?…]+(?:\s|$)/)[0];
      left = dedupe(dropFiller(clip(left))); right = dropFiller(clip(right));
      if (!/\p{L}/u.test(left) || !/\p{L}/u.test(right)) continue;
      var lw = left.split(' ').length, rw = right.split(' ').length;
      var R = rw > 3 ? [firstWords(right, 2), firstWords(right, 3), firstWords(right, 6)] : [right];
      var L = lw <= 2 ? [left] : lw <= 4 ? [left, lastWords(left, 2), lastWords(left, 1)] : [lastWords(left, 2), lastWords(left, 4), lastWords(left, 1)];
      // сначала короткие сочетания: лишние слова мешают поиску сильнее, чем недостающие
      L.forEach(function (l, i) { R.forEach(function (r, j) { out.push({ query: (l + ' ' + r).trim(), kind: 'dash', w: i + j }); }); });
    }
    return out;
  }

  // План поиска для сообщения: ссылки, запросы по тире, запросы по словам про музыку.
  // signal: 'link' | 'dash' | 'music' | 'latin' | 'none'
  function plan(message) {
    var raw = String(message || '');
    var links = (raw.match(URL_RX) || []).map(function (u) { return /^https?:/i.test(u) ? u : 'https://' + u; });
    var text = prep(raw.replace(URL_RX, ' '));
    var queries = [], seen = {};
    function add(q) { var k = normAll(q.query); if (!k || seen[k] || k.length < 3) return; seen[k] = 1; queries.push(q); }
    splitChunks(text).forEach(function (c, ci) { dashQueries(c).sort(function (x, y) { return x.w - y.w; }).forEach(function (q) { q.chunk = ci; add(q); }); });
    var signal = links.length ? 'link' : queries.length ? 'dash' : 'none';
    if (!queries.length && MUSIC_RX.test(text)) {
      signal = links.length ? 'link' : 'music';
      text.split(/[.!?…\n;]+|\)\)+/).forEach(function (s) {
        var q = dropFiller(clip(s)).replace(/^[,\s]+|[,\s]+$/g, '');
        if (q.split(' ').length >= 2 && q.split(' ').length <= 12) add({ query: q, kind: 'music' });
      });
    }
    // Коротко и латиницей («EPIC Calypso») — пробуем, но засчитываем только точное совпадение
    if (!queries.length && !links.length && /^[a-z0-9 '’&.,!?-]{4,60}$/i.test(text) && text.split(' ').length <= 6 && /[a-z]{3}/i.test(text)) {
      signal = 'latin'; add({ query: clip(text), kind: 'latin' });
    }
    return { links: links, queries: queries.slice(0, 12), signal: signal, text: text };
  }

  // Насколько найденный трек подтверждается текстом сообщения
  function judge(message, track) {
    var have = tokens(prep(message));
    var tt = tokens(track.title), at = tokens(track.author);
    if (!tt.length) return { level: 'none', t: 0, a: 0 };
    var t = frac(tt, have), a = at.length ? frac(at, have) : 0;
    var level = (t >= 0.99 && (a >= 0.99 || (at.length >= 3 && a >= 0.66))) ? 'exact' : (t >= 0.99 || (t >= 0.5 && a >= 0.5)) ? 'doubt' : 'none';
    return { level: level, t: t, a: a };
  }

  // Пометки спорного трека. rules: { maxSec, stopWords:[...], explicitOk }
  var NONMUSIC = /(обзор|review|стрим\b|stream|gameplay|геймплей|летсплей|let'?s ?play|прохожден|подкаст|podcast|интервью|interview|реакци|reaction|трейлер|trailer|новост|\bnews\b|выпуск|tutorial|гайд|guide|туториал|asmr|аудиокниг|audiobook|пранк|prank|compilation|подборк|сборник|\bmix\b|\bмикс\b|\d+\s*(hours?|час)|full album|полный альбом|nonstop|non-stop|best of|лучшее за)/i;
  var TROLL = /(ear ?rape|earrape|громк\S* звук|скример|screamer|bass ?boosted|басс ?буст|loud|орущ|крик)/i;
  var VERSION = /\b(remix|ремикс|sped ?up|speed ?up|slowed|nightcore|cover|кавер|live|лайв|karaoke|караоке|8d|reverb|instrumental|минус|phonk ?remix|mashup|мэшап)\b/i;
  function stopHit(words, hay) {
    var h = ' ' + normAll(hay) + ' ';
    for (var i = 0; i < (words || []).length; i++) {
      var w = normAll(words[i]); if (!w) continue;
      if (w.length <= 4 ? h.indexOf(' ' + w + ' ') >= 0 : h.indexOf(' ' + w) >= 0) return words[i];
    }
    return '';
  }
  function flags(track, message, rules) {
    rules = rules || {};
    var out = [], hay = (track.author || '') + ' ' + (track.title || '') + ' ' + (track.album || '');
    var maxSec = rules.maxSec == null ? 420 : rules.maxSec;
    if (maxSec && track.seconds && track.seconds > maxSec) out.push({ k: 'long', t: 'длинный: ' + fmt(track.seconds) });
    if (track.explicit && !rules.explicitOk) out.push({ k: 'explicit', t: '18+' });
    var s = stopHit(rules.stopWords, hay);
    if (s) out.push({ k: 'stop', t: 'стоп-лист: ' + s });
    if (NONMUSIC.test(track.title || '') && !NONMUSIC.test(message || '')) out.push({ k: 'nonmusic', t: 'не музыка?' });
    if (TROLL.test(hay)) out.push({ k: 'troll', t: 'троллинг?' });
    var v = (track.title || '').match(VERSION);
    if (v && !new RegExp('\\b' + v[1].replace(/\s/g, '\\s?'), 'i').test(message || '')) out.push({ k: 'version', t: 'не та версия: ' + v[1].toLowerCase() });
    return out;
  }
  function fmt(sec) { sec = Math.round(sec || 0); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s; }

  // Сколько треков оплачено. price — цена в валюте стримера; amount — сумма в ней же (или null, если валюта другая)
  function paidCount(amount, price) { if (!price || amount == null) return Infinity; return Math.floor((amount + 0.001) / price); }

  // Стоп-лист по умолчанию (владелец: «ничего связанного с расизмом и ЛГБТ»). Срабатывает по словам в названии,
  // исполнителе и альбоме — стример правит список в настройках.
  var DEFAULT_STOP = ['лгбт', 'lgbt', 'lgbtq', 'pride', 'прайд', 'gay', 'гей', 'геи', 'лесби', 'lesbian', 'трансгендер', 'transgender', 'queer', 'квир', 'rainbow pride', 'white power', 'white pride', 'sieg heil', 'зиг хайль', 'расист', 'racist', 'нацист', 'nazi', 'kkk', 'ку клукс'];

  var api = { plan: plan, judge: judge, flags: flags, paidCount: paidCount, prep: prep, tokens: tokens, tokEq: tokEq, fmt: fmt, DEFAULT_STOP: DEFAULT_STOP, MUSIC_RX: MUSIC_RX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapReq = api;
})(this);
