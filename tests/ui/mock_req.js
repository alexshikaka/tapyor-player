// Добавка к mock5.js: заказы со стрима, сервисы донатов, сайт-визитка
(function(){
  var P = function(v){ return new Promise(function(r){ setTimeout(function(){ r(v); }, 20); }); };
  var A = window.app, L = window.__log;
  var T = function(id, author, title, sec, extra){ return Object.assign({ src: 'ym', id: String(id), albumId: '9', title: title, author: author, duration: Math.floor(sec/60) + ':' + ('0' + sec%60).slice(-2), seconds: sec, thumb: '' }, extra || {}); };
  window.__T = T;
  var don = { da: { name: 'DonationAlerts', connected: true, ok: true, account: { name: 'alexshikaka' }, configured: true }, dp: { name: 'DonatePay', connected: false }, dn: { name: 'Donatello', connected: false } };
  var site = { configured: false, connected: false, account: null, url: '' };
  A.reqList = function(){ return P([]); };
  A.reqUpdate = function(k, p){ L.push('reqUpdate ' + k + ' ' + (p.items || []).map(function (i){ return i.state || '-'; }).join(',')); return P(true); };
  A.reqClear = function(){ L.push('reqClear'); return P([]); };
  A.reqRemember = function(line, t){ L.push('remember ' + line + ' → ' + t.title); return P(true); };
  A.onReqNew = function(cb){ window.__reqCb = cb; };
  A.reqTest = function(text, amt){ L.push('reqTest ' + text + ' ' + amt); var r = { key: 'test:1', prov: 'test', name: 'Пробный заказ', text: text, amount: amt, currency: 'RUB', at: Date.now(), got: Date.now(), level: 'exact', state: 'new', items: [{ level: 'exact', track: T(77, 'Кино', 'Кукушка', 398), alts: [], flags: [], paid: true }] }; setTimeout(function(){ window.__reqCb && window.__reqCb(r); }, 5); return P(r); };
  A.donStatus = function(){ return P(don); };
  A.onDonStatus = function(cb){ window.__donCb = cb; };
  A.donDaLogin = function(){ return P({ ok: true }); }; A.donDaCancel = function(){ return P(true); };
  A.donSetKey = function(p, k){ L.push('donSetKey ' + p + ' ' + k.length); don[p].connected = true; don[p].ok = true; don[p].account = { name: 'tester' }; return P({ ok: true }); };
  A.donDisconnect = function(p){ don[p].connected = false; return P(true); };
  A.siteStatus = function(){ return P(site); };
  A.sitePreview = function(p){ L.push('sitePreview ' + p.price + ' ' + Object.keys(p.donate || {}).join(',')); return P('<html><body><h1>' + (p.nick || '') + '</h1><p>Заказать песню</p></body></html>'); };
  A.sitePublish = function(p){ L.push('sitePublish ' + p.nick); site.url = 'https://alexshikaka.github.io/tapyor-page/'; return P({ ok: true, url: site.url }); };
  A.siteSave = function(){ return P({ ok: true }); };
  A.siteGhToken = function(t){ L.push('ghToken ' + t.length); site.connected = !!t; site.account = t ? { login: 'alexshikaka' } : null; return P({ ok: true }); };
  A.openLink = function(u){ L.push('openLink ' + u); return P(true); };
})();
