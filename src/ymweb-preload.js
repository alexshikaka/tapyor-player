// Скрытое окно с официальным сайтом Яндекс Музыки (запасной способ).
// Этот файл работает внутри сайта: следит за звуком страницы и передаёт команды Тапёра.
const { ipcRenderer, webFrame } = require('electron');

// Код для «мира» самой страницы: перехватываем запуск звука, чтобы знать, какой элемент играет
const PAGE = `(function(){
  if (window.__tapYM) return;
  var cur = null, hold = true, lastT = 0, vol = 1;
  function meta(){
    var m = navigator.mediaSession && navigator.mediaSession.metadata;
    return { title: m ? (m.title || '') : '', artist: m ? (m.artist || '') : '' };
  }
  function post(ev){
    var e = cur; if (!e) return;
    var now = Date.now();
    if (ev === 'timeupdate' && now - lastT < 240) return;
    lastT = now;
    var md = meta();
    window.postMessage({ __tapYM: 1, ev: ev, paused: e.paused, ended: e.ended, time: e.currentTime || 0, dur: e.duration || 0, title: md.title, artist: md.artist }, '*');
  }
  function bind(el){
    if (el.__tapBound) return; el.__tapBound = 1;
    ['play', 'playing', 'pause', 'ended', 'timeupdate', 'durationchange', 'error'].forEach(function(ev){
      el.addEventListener(ev, function(){
        if ((ev === 'play' || ev === 'playing') && hold) { try { el.pause(); } catch (x) {} return; }
        if (ev === 'play' || ev === 'playing') { cur = el; el.volume = vol; }
        if (ev === 'ended' && el === cur) hold = true; // сайт не должен сам включить следующий трек
        if (el === cur) post(ev);
      });
    });
  }
  var op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function(){
    bind(this);
    if (hold) return Promise.resolve();
    cur = this; this.volume = vol;
    return op.apply(this, arguments);
  };
  function allMedia(){ var a = Array.prototype.slice.call(document.querySelectorAll('audio,video')); if (cur && a.indexOf(cur) < 0) a.push(cur); return a; }
  function visible(el){ var r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && getComputedStyle(el).visibility !== 'hidden'; }
  function inPlayerBar(el){ return !!el.closest('[class*="PlayerBar"],[class*="playerBar"],[class*="player-controls"],[data-test-id*="PLAYERBAR"],footer'); }
  function label(el){ return ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-test-id') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '')).replace(/\\s+/g, ' ').trim().slice(0, 80); }
  // Кнопка «Слушать» на странице трека (не в нижней панели плеера)
  function findPlay(){
    var btns = Array.prototype.slice.call(document.querySelectorAll('button,[role="button"],a[href]')).filter(visible);
    var scored = btns.map(function(b){
      var l = label(b).toLowerCase(), s = 0;
      if (/play|слушать|воспроизв|играть/.test(l)) s += 5;
      if (/pause|пауза|playerbar|next|prev|след|пред|shuffle|перемеш|repeat|повтор|like|нрав|volume|громк|video|видео|trailer|трейлер|wave|волн/.test(l)) s -= 8;
      if (/track|трек|header|page/.test(l)) s += 2;
      if (inPlayerBar(b)) s -= 10;
      var r = b.getBoundingClientRect(); if (r.top < window.innerHeight * 0.6) s += 1;
      return { b: b, s: s, l: label(b) };
    }).filter(function(x){ return x.s >= 5; }).sort(function(a, b){ return b.s - a.s; });
    return scored;
  }
  window.addEventListener('message', function(e){
    var d = e.data; if (!d || d.__tapCmd !== 1) return;
    var reply = function(o){ window.postMessage(Object.assign({ __tapYMr: 1, id: d.id }, o), '*'); };
    if (d.cmd === 'hold') { hold = true; allMedia().forEach(function(m){ try { m.pause(); } catch (x) {} }); cur = null; reply({ ok: true }); }
    else if (d.cmd === 'start') {
      var c = findPlay();
      if (!c.length) { var any = Array.prototype.slice.call(document.querySelectorAll('button')).filter(visible).slice(0, 25).map(label); reply({ ok: false, seen: any }); return; }
      hold = false; c[0].b.click(); reply({ ok: true, clicked: c[0].l, others: c.slice(1, 4).map(function(x){ return x.l; }) });
    }
    else if (d.cmd === 'pause') { if (cur) cur.pause(); reply({ ok: true }); }
    else if (d.cmd === 'resume') { hold = false; if (cur) op.call(cur).catch(function(){}); reply({ ok: true }); }
    else if (d.cmd === 'seek') { if (cur) cur.currentTime = d.value; reply({ ok: true }); }
    else if (d.cmd === 'volume') { vol = Math.max(0, Math.min(1, d.value)); allMedia().forEach(function(m){ m.volume = vol; }); reply({ ok: true }); }
    else if (d.cmd === 'info') { var md = meta(); reply({ ok: true, title: md.title, artist: md.artist, playing: !!(cur && !cur.paused), time: cur ? cur.currentTime : 0, dur: cur ? cur.duration : 0, url: location.href, loggedIn: !!document.querySelector('[class*="UserAvatar"],[data-test-id*="USER"],[aria-label*="Профиль"],[aria-label*="профиль"]') }); }
  });
  window.__tapYM = true;
})();`;

try { webFrame.executeJavaScript(PAGE); } catch (e) {}
// На случай поздней загрузки: повторить, если страница перерисовалась целиком
window.addEventListener('DOMContentLoaded', () => { try { webFrame.executeJavaScript(PAGE); } catch (e) {} });

let seq = 0;
const waits = new Map();
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d) return;
  if (d.__tapYM === 1) ipcRenderer.send('ymweb-state', d);
  if (d.__tapYMr === 1 && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
});
ipcRenderer.on('ymweb-cmd', (e, cmd, value, replyId) => {
  const id = ++seq;
  const t = setTimeout(() => { if (waits.has(id)) { waits.delete(id); ipcRenderer.send('ymweb-reply', replyId, { ok: false, error: 'страница не ответила' }); } }, 4000);
  waits.set(id, (d) => { clearTimeout(t); ipcRenderer.send('ymweb-reply', replyId, d); });
  window.postMessage({ __tapCmd: 1, id, cmd, value }, '*');
});
