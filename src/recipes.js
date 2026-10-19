// «Рецепты» сайтов: как найти кнопку «Слушать» и проверить, что играет нужный трек.
// Встроенная копия + свежая с GitHub (только данные — никакого кода не скачивается и не выполняется).
const { net } = require('electron');
const fs = require('fs');
const path = require('path');

const REMOTE = 'https://raw.githubusercontent.com/shikaka068091/stream-player/main/src/recipes.json';
let log = () => {};
let cacheFile = '';
let appVersion = '0.0.0';
let current = null;
let source = 'встроенные';

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
// Проверка, что файл похож на рецепты: нужные поля и строки, регулярки собираются
function valid(j) {
  try {
    if (!j || typeof j.version !== 'number' || !j.yandex || !j.yandex.play) return false;
    const p = j.yandex.play;
    ['include', 'exclude', 'boost'].forEach((k) => { if (p[k] != null) new RegExp(p[k], 'i'); });
    if (p.preferSelectors && !Array.isArray(p.preferSelectors)) return false;
    if (j.minApp && cmpVer(j.minApp, appVersion) > 0) return false; // рецепт для более новой версии Тапёра
    return true;
  } catch (e) { return false; }
}
function bundled() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'recipes.json'), 'utf8')); } catch (e) { return null; } }

function setup(o) {
  log = o.log || log; cacheFile = o.cacheFile || ''; appVersion = o.appVersion || appVersion;
  current = bundled();
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (valid(c) && (!current || c.version >= current.version)) { current = c; source = 'с GitHub (сохранённые)'; }
  } catch (e) {}
}
async function refresh() {
  try {
    const r = await net.fetch(REMOTE + '?t=' + Date.now(), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!valid(j)) { log('рецепты: файл с GitHub не подходит этой версии — остаюсь на прежних'); return { ok: false }; }
    if (!current || j.version >= current.version) {
      if (!current || j.version > current.version) log('рецепты: обновлены до версии ' + j.version);
      current = j; source = 'с GitHub';
      try { fs.writeFileSync(cacheFile, JSON.stringify(j, null, 2)); } catch (e) {}
    }
    return { ok: true, version: current.version };
  } catch (e) { log('рецепты: GitHub недоступен (' + e.message + ') — работаю на ' + source); return { ok: false }; }
}
function get() { return current || bundled() || {}; }
function info() { return { version: (current && current.version) || 0, source }; }

module.exports = { setup, refresh, get, info };
