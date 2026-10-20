// Темы оформления: из 5 основных цветов (режим, фон, текст, акцент, главная кнопка) строим все ~20 оттенков интерфейса.
// Считаем в OKLCH — там «светлее/темнее» выглядит для глаза ровно. Следим за контрастом текста.
// Работает в окне Тапёра (window.TapTheme) и в Node (для проверок).
(function (root) {
  // ---- цвет: hex ↔ OKLCH ----
  function hex2rgb(h) { h = String(h || '').replace('#', ''); if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join(''); var n = parseInt(h, 16); if (isNaN(n) || h.length !== 6) return null; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgb2hex(r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join('').toUpperCase(); }
  function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function unlin(c) { return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055); }
  function rgb2oklch(rgb) {
    var r = lin(rgb[0]), g = lin(rgb[1]), b = lin(rgb[2]);
    var l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    var C = Math.sqrt(A * A + B * B), H = Math.atan2(B, A) * 180 / Math.PI; if (H < 0) H += 360;
    return { l: L, c: C, h: H };
  }
  function oklch2rgbRaw(o) {
    var a = o.c * Math.cos(o.h * Math.PI / 180), b = o.c * Math.sin(o.h * Math.PI / 180);
    var l = Math.pow(o.l + 0.3963377774 * a + 0.2158037573 * b, 3), m = Math.pow(o.l - 0.1055613458 * a - 0.0638541728 * b, 3), s = Math.pow(o.l - 0.0894841775 * a - 1.2914855480 * b, 3);
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  }
  function inGamut(o) { var r = oklch2rgbRaw(o); return r.every(function (v) { return v >= -0.0005 && v <= 1.0005; }); }
  // Если цвет не помещается в экран — уменьшаем насыщенность, сохраняя яркость и тон
  function oklch2hex(o) {
    o = { l: Math.max(0, Math.min(1, o.l)), c: Math.max(0, o.c), h: o.h };
    if (!inGamut(o)) { var lo = 0, hi = o.c; for (var i = 0; i < 18; i++) { var mid = (lo + hi) / 2; if (inGamut({ l: o.l, c: mid, h: o.h })) lo = mid; else hi = mid; } o.c = lo; }
    return rgb2hex(oklch2rgbRaw(o).map(unlin));
  }
  function ok(hex) { return rgb2oklch(hex2rgb(hex) || [0, 0, 0]); }
  function lum(hex) { var r = hex2rgb(hex) || [0, 0, 0]; return 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]); }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) { var x = ok(a), y = ok(b); var hx = x.c < 0.02 ? y.h : x.h, hy = y.c < 0.02 ? x.h : y.h; var dh = ((hy - hx + 540) % 360) - 180; return oklch2hex({ l: x.l + (y.l - x.l) * t, c: x.c + (y.c - x.c) * t, h: hx + dh * t }); }
  function shift(hex, dl, cmul) { var o = ok(hex); return oklch2hex({ l: o.l + dl, c: o.c * (cmul == null ? 1 : cmul), h: o.h }); }
  // Подвинуть яркость, пока контраст с фоном не станет нужным
  function ensure(fg, bg, need, dark) {
    var o = ok(fg), k = 0;
    while (contrast(oklch2hex(o), bg) < need && k++ < 60) o.l += dark ? 0.012 : -0.012;
    return oklch2hex(o);
  }

  // ---- из основных цветов — все переменные интерфейса ----
  // t: { mode:'dark'|'light', bg, text, accent, primary, contrast:0..100 }
  function build(t) {
    var dark = t.mode !== 'light', k = 0.55 + (Math.max(0, Math.min(100, t.contrast == null ? 50 : t.contrast)) / 100) * 0.9; // шаги между уровнями
    var b = ok(t.bg), sgn = dark ? 1 : -1;
    var L = function (d, cm) { return oklch2hex({ l: b.l + d * k, c: b.c * (cm == null ? 1 : cm), h: b.h }); };
    var v = {};
    if (dark) {
      v.bg00 = L(-0.045, 0.9); v.bg0 = L(-0.028, 0.95); v.bg1 = t.bg; v.bg2 = L(0.016); v.bg3 = L(0.04, 1.05); v.bg4 = L(0.085, 1.05);
      v.ln = L(0.1, 1.05); v.ln2 = L(0.055); v.ln3 = L(0.16, 1.05);
    } else {
      v.bg00 = L(-0.075); v.bg0 = L(-0.035); v.bg1 = t.bg; v.bg2 = oklch2hex({ l: Math.min(0.995, b.l + 0.02), c: b.c * 0.6, h: b.h }); v.bg3 = L(-0.05); v.bg4 = L(-0.1);
      v.ln = L(-0.13); v.ln2 = L(-0.075); v.ln3 = L(-0.22);
    }
    var tx = ensure(t.text, v.bg1, 4.5 + 3 * (k - 0.55) / 0.9 + 3, dark);
    v.tx = tx;
    v.tx2 = ensure(mix(tx, v.bg1, 0.16 / k), v.bg1, 7, dark);
    v.tx3 = ensure(mix(tx, v.bg1, 0.34 / k), v.bg1, 4.6, dark);
    v.tx4 = ensure(mix(tx, v.bg1, 0.44 / k), v.bg1, 3.4, dark);
    v.tx5 = ensure(mix(tx, v.bg1, 0.52 / k), v.bg1, 2.8, dark);
    var ac = ensure(t.accent, v.bg1, 3, dark);
    v.ac = ac; v.ac2 = shift(ac, dark ? 0.09 : -0.08, 0.85);
    var r = hex2rgb(ac); v.acr = r.join(',');
    v.acbg = mix(v.bg1, ac, dark ? 0.16 : 0.12);
    v.pri = t.primary; v.prit = contrast('#FFFFFF', t.primary) >= contrast('#111111', t.primary) ? '#FFFFFF' : '#111111';
    return v;
  }

  // ---- направления для «Подобрать палитру» (свой генератор, без интернета) ----
  var TONES = {
    red: { h: 25, n: 'Красная' }, orange: { h: 55, n: 'Оранжевая' }, yellow: { h: 92, n: 'Жёлтая' }, green: { h: 150, n: 'Зелёная' },
    teal: { h: 190, n: 'Бирюзовая' }, blue: { h: 262, n: 'Синяя' }, violet: { h: 300, n: 'Фиолетовая' }, pink: { h: 350, n: 'Розовая' },
    warm: { h: 60, n: 'Тёплая', soft: true }, cold: { h: 235, n: 'Холодная', soft: true }, mono: { h: 0, n: 'Монохром', mono: true }
  };
  var CHARS = { tone: 'В тон', contrast: 'Контрастные', triad: 'Три цвета', near: 'Соседние' };
  function suggest(opt, seed) {
    var dark = opt.mode !== 'light', T = TONES[opt.tone] || TONES.violet, h = T.h, mono = !!T.mono;
    var ch = opt.chars || 'tone';
    var acH = h + ({ tone: 0, contrast: 180, triad: 120, near: 32 }[ch] || 0);
    var prH = h + ({ tone: 0, contrast: 0, triad: 240, near: -32 }[ch] || 0);
    var rnd = (function (x) { return function () { x = (x * 9301 + 49297) % 233280; return x / 233280; }; })(seed || 1);
    var out = [];
    var bgC = [0.35, 0.8, 1.4], acL = [0.66, 0.74];
    for (var i = 0; i < 6; i++) {
      var bc = bgC[i % 3] * (T.soft ? 0.7 : 1) * (mono ? 0 : 1), al = acL[Math.floor(i / 3)] + (rnd() - 0.5) * 0.04, jit = (rnd() - 0.5) * 12;
      var bg = dark ? oklch2hex({ l: 0.175 + (rnd() - 0.5) * 0.02, c: 0.022 * bc, h: h + jit }) : oklch2hex({ l: 0.965, c: 0.012 * bc, h: h + jit });
      var text = dark ? oklch2hex({ l: 0.95, c: mono ? 0 : 0.012, h: h }) : oklch2hex({ l: 0.22, c: mono ? 0 : 0.02, h: h });
      var accent = mono ? oklch2hex({ l: dark ? 0.82 : 0.35, c: 0, h: 0 }) : oklch2hex({ l: dark ? al : al - 0.16, c: T.soft ? 0.09 : 0.16, h: acH + jit });
      var primary = mono ? oklch2hex({ l: dark ? 0.93 : 0.25, c: 0, h: 0 })
        : (ch === 'tone' ? oklch2hex({ l: dark ? 0.86 : 0.45, c: T.soft ? 0.07 : 0.11, h: h + jit }) : oklch2hex({ l: dark ? 0.84 : 0.5, c: T.soft ? 0.1 : 0.15, h: prH + jit }));
      out.push({ mode: dark ? 'dark' : 'light', bg: bg, text: text, accent: accent, primary: primary, contrast: 50, src: 'local' });
    }
    return out;
  }
  // Палитра из внешнего сервиса (The Color API): из 5 цветов — наши 4 основных
  function fromScheme(hexes, mode) {
    var dark = mode !== 'light';
    var list = hexes.map(function (x) { var o = ok(x); return { hex: x, o: o }; });
    var bySat = list.slice().sort(function (a, b) { return b.o.c - a.o.c; });
    var acc = bySat[0], pri = bySat[1] || bySat[0];
    var base = list.slice().sort(function (a, b) { return dark ? a.o.l - b.o.l : b.o.l - a.o.l; })[0];
    var bg = oklch2hex({ l: dark ? 0.175 : 0.965, c: Math.min(base.o.c, dark ? 0.03 : 0.014), h: base.o.h });
    var text = oklch2hex({ l: dark ? 0.95 : 0.22, c: Math.min(0.015, base.o.c), h: base.o.h });
    var accent = oklch2hex({ l: dark ? Math.max(0.62, Math.min(0.78, acc.o.l)) : Math.min(0.55, acc.o.l), c: acc.o.c, h: acc.o.h });
    var primary = oklch2hex({ l: dark ? Math.max(0.78, pri.o.l) : Math.min(0.5, pri.o.l), c: pri.o.c, h: pri.o.h });
    return { mode: dark ? 'dark' : 'light', bg: bg, text: text, accent: accent, primary: primary, contrast: 50, src: 'api' };
  }

  // ---- код темы, чтобы делиться ----
  function encode(t) { return ['TAPYOR1', t.mode === 'light' ? 'l' : 'd', t.bg, t.text, t.accent, t.primary, t.contrast == null ? 50 : t.contrast, encodeURIComponent(t.name || '')].join(':').replace(/#/g, ''); }
  function decode(s) {
    var p = String(s || '').trim().split(':');
    if (p[0] !== 'TAPYOR1' || p.length < 7) return null;
    var hx = function (x) { return /^[0-9a-f]{6}$/i.test(x) ? '#' + x.toUpperCase() : null; };
    var t = { mode: p[1] === 'l' ? 'light' : 'dark', bg: hx(p[2]), text: hx(p[3]), accent: hx(p[4]), primary: hx(p[5]), contrast: Math.max(0, Math.min(100, parseInt(p[6], 10) || 50)), name: p[7] ? decodeURIComponent(p[7]).slice(0, 40) : '' };
    return t.bg && t.text && t.accent && t.primary ? t : null;
  }

  var api = { build: build, suggest: suggest, fromScheme: fromScheme, encode: encode, decode: decode, contrast: contrast, mix: mix, ok: ok, oklch2hex: oklch2hex, TONES: TONES, CHARS: CHARS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TapTheme = api;
})(this);
