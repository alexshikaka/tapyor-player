// Аудит оболочек: находит элементы, которые «выпали» из оформления кожи.
//
// Что проверяет:
//   1. УГЛЫ      — в оболочке все углы должны быть 0; ненулевой радиус = элемент выпал.
//   2. ШРИФТ     — текст должен идти шрифтом оболочки (кроме mono/hex/кода).
//   3. ХРОМ      — видимая панель с фоном должна иметь фаску/свечение (иначе «плоская»).
//   4. ПАЛИТРА   — заливка должна быть из цветов кожи, а не жёстко зашитой в коде.
//
// Список «покрытых» классов аудит не задаёт руками: он читает его из cssRules
// самих правил html.pixel-skin / html.skin-*, поэтому новые правила подхватываются сами.
//
// Запуск:
//   node tests/skins/audit.js                 — все оболочки, сводка
//   node tests/skins/audit.js --skins=crt      — только одна
//   node tests/skins/audit.js --verbose        — все находки, а не первые 8
//   node tests/skins/audit.js --json            — машинный вывод
//
// Код выхода: 1 — есть ошибки (углы/шрифт), 0 — только предупреждения и информация.

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

// playwright-core: берём локальный, а если его нет — ищем рядом (dev-окружение)
function loadPlaywright() {
  const tries = [
    'playwright-core',
    process.env.PLAYWRIGHT_PATH,
    path.join(ROOT, 'node_modules', 'playwright-core'),
    'C:/tapyor-verify/node_modules/playwright-core'
  ].filter(Boolean);
  for (const t of tries) {
    try { return require(t); } catch (e) { /* следующий */ }
  }
  console.error('Не найден playwright-core. Поставьте его: npm i -D playwright-core');
  console.error('или укажите путь в PLAYWRIGHT_PATH (папка модуля).');
  process.exit(2);
}
const { chromium } = loadPlaywright();

const CHROME = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  .filter(Boolean)
  .find((p) => fs.existsSync(p));
if (!CHROME) { console.error('Не найден Chrome/Edge. Укажите CHROME_PATH.'); process.exit(2); }
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.json': 'application/json', '.svg': 'image/svg+xml' };

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const JSON_OUT = argv.includes('--json');
const only = (argv.find((a) => a.startsWith('--skins=')) || '').split('=')[1];

function serve() {
  const srv = http.createServer((req, res) => {
    const clean = decodeURIComponent(String(req.url || '/').split('?')[0]);
    const file = path.join(ROOT, clean);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('no'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

// Всё, что считается внутри страницы
function auditInPage() {
  const html = document.documentElement;
  const bodyCS = getComputedStyle(document.body);
  const expectedFont = bodyCS.fontFamily;

  // 1. Классы, которые оболочка уже оформляет, и разрешённые шрифты — из её же правил
  const covered = new Set();
  const skinFonts = new Set();
  const skinColors = new Set();
  const firstFamily = (v) => String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
  skinFonts.add(firstFamily(expectedFont));
  for (const sheet of Array.from(document.styleSheets)) {
    let rules = null;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    if (!rules) continue;
    for (const rule of Array.from(rules)) {
      const sel = rule.selectorText || '';
      if (!/pixel-skin|skin-/.test(sel)) continue;
      for (const part of sel.split(',')) {
        const m = part.match(/\.([A-Za-z0-9_-]+)/g) || [];
        for (const one of m) covered.add(one.slice(1));
      }
      const ff = rule.style && rule.style.getPropertyValue('font-family');
      if (ff) for (const fam of ff.split(',')) skinFonts.add(firstFamily(fam));
      // цвета, объявленные самой оболочкой, — тоже её палитра
      const cssText = rule.cssText || '';
      const colorRe = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
      let mColor;
      while ((mColor = colorRe.exec(cssText))) skinColors.add(mColor[0].toLowerCase());
    }
  }

  // 2. Палитра оболочки — раскрываем токены в rgb
  const tokenNames = ['bg00', 'bg0', 'bg1', 'bg2', 'bg3', 'bg4', 'ln', 'ln2', 'ln3', 'tx', 'tx2', 'tx3', 'tx4', 'tx5', 'ac', 'ac2', 'pri', 'prit'];
  const probe = document.createElement('div');
  probe.style.position = 'fixed'; probe.style.opacity = '0'; probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const tokens = new Set();
  for (const n of tokenNames) {
    probe.style.color = 'var(--' + n + ')';
    const v = getComputedStyle(probe).color;
    if (v && v !== 'rgb(0, 0, 0)') tokens.add(v);
  }
  probe.remove();

  const rgba = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex2rgb = (h) => {
    const s = String(h).replace('#', '');
    if (s.length === 3) return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16), a: 1 };
    if (s.length < 6) return null;
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16), a: 1 };
  };
  const key = (c) => (c ? Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) : '');
  const same = (a, b) => a && b && Math.abs(a.r - b.r) < 3 && Math.abs(a.g - b.g) < 3 && Math.abs(a.b - b.b) < 3;
  // всё, что оболочка объявила сама (hex в правилах браузер отдаёт как rgb()) — тоже палитра
  const skinRgb = new Set();
  for (const raw of skinColors) {
    const parsed = raw[0] === '#' ? hex2rgb(raw) : rgba(raw);
    if (parsed) skinRgb.add(key(parsed));
  }
  const inPalette = (color) => {
    const c = rgba(color); if (!c) return true;
    for (const t of tokens) if (same(c, rgba(t))) return true;
    if (skinRgb.has(key(c))) return true;
    return false;
  };

  const cssPath = (el) => {
    const bits = [];
    let cur = el, depth = 0;
    while (cur && cur !== document.body && depth < 4) {
      let s = cur.tagName.toLowerCase();
      if (cur.id) s += '#' + cur.id;
      else if (cur.classList.length) s += '.' + Array.from(cur.classList).slice(0, 2).join('.');
      bits.unshift(s);
      cur = cur.parentElement; depth++;
    }
    return bits.join(' > ');
  };

  const skipTag = /^(img|canvas|video|audio|webview|svg|path|circle|rect|line|use|source|input|textarea|select|option|br|hr|script|style)$/i;
  const skipCls = /(mono|te-hex|te-name|log|code|preview|thumb|cover|avatar|webview|iframe)/i;
  // элементы-превью и контейнеры внешней страницы: цвет по замыслу, не по коже
  const skipBox = /(^|\s)(te-c|p|br-wrap|br-web|skin-pv|sp-card|sp-line|sp-btn)(\s|$)/i;

  const findings = { radius: [], font: [], chrome: [], palette: [] };
  const all = Array.from(document.querySelectorAll('body *'));

  for (const el of all) {
    if (skipTag.test(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (el.closest('[hidden]')) continue;
    const cls = Array.from(el.classList);
    const clsStr = cls.join(' ');
    if (skipCls.test(clsStr) || skipBox.test(clsStr)) continue;
    if (el.closest('.te-c, .br-wrap, .skin-pv, .skin-c')) continue;
    const coveredEl = cls.some((c) => covered.has(c));
    const area = rect.width * rect.height;
    const text = (el.textContent || '').trim();

    // УГЛЫ
    const radii = ['borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius'].map((k) => parseFloat(cs[k]) || 0);
    if (Math.max.apply(null, radii) > 0.5) {
      findings.radius.push({ el: cssPath(el), cls: clsStr, value: cs.borderTopLeftRadius });
    }

    // ШРИФТ
    if (text.length > 1 && !skinFonts.has(firstFamily(cs.fontFamily))) {
      findings.font.push({ el: cssPath(el), cls: clsStr, font: cs.fontFamily });
    }

    // ХРОМ: структурная панель с заливкой без фаски/ореола
    const bg = rgba(cs.backgroundColor);
    const structural = /(card|panel|col|box|bar|wrap|side|list|sheet|note|test|sum|feed|done|it|row)/i.test(clsStr);
    if (bg && bg.a > 0.25 && area > 1800 && structural && !coveredEl && cs.boxShadow === 'none' && cs.display !== 'inline') {
      findings.chrome.push({ el: cssPath(el), cls: clsStr, bg: cs.backgroundColor });
    }

    // ПАЛИТРА: плотная заливка не из цветов кожи (кроме опознавательных значков сервисов)
    const brand = /(^|\s)(dot|ico|ai|wch|badge|cover|thumb)(\s|$)/i.test(clsStr);
    if (!brand && bg && bg.a > 0.85 && area > 400 && cs.display !== 'inline' && !inPalette(cs.backgroundColor)) {
      findings.palette.push({ el: cssPath(el), cls: clsStr, bg: cs.backgroundColor });
    }
  }

  return {
    skin: Array.from(html.classList).find((c) => c.startsWith('skin-')) || '(нет)',
    covered: Array.from(covered).length,
    tokens: Array.from(tokens).length,
    findings
  };
}

async function toggleAllTabs(page) {
  const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('nav button[data-tab]')).map((b) => b.dataset.tab));
  const out = [];
  for (const t of tabs) {
    try {
      await page.evaluate((tab) => setTab(tab), t);
      await page.waitForTimeout(280);
      out.push([t, await page.evaluate(auditInPage)]);
    } catch (e) {
      out.push([t, { error: String(e).slice(0, 120) }]);
    }
  }
  return out;
}

function mergeFindings(parts) {
  const merged = { radius: [], font: [], chrome: [], palette: [] };
  for (const [, res] of parts) {
    if (!res || !res.findings) continue;
    for (const k of Object.keys(merged)) merged[k].push(...res.findings[k]);
  }
  // уникализируем по пути
  for (const k of Object.keys(merged)) {
    const seen = new Set();
    merged[k] = merged[k].filter((f) => { const key = f.el + '|' + (f.value || f.bg || ''); if (seen.has(key)) return false; seen.add(key); return true; });
  }
  return merged;
}

(async () => {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript({ path: path.join(ROOT, 'tests', 'ui', 'mock7.js') });
  await page.goto('http://127.0.0.1:' + port + '/src/index.html');
  await page.waitForTimeout(1400);

  const skins = await page.evaluate(() => (window.SKINS || []).map((s) => ({ id: s.id, name: s.name })));
  const list = only ? skins.filter((s) => only.split(',').includes(s.id)) : skins;
  if (!list.length) {
    console.error('Не найдено ни одной оболочки (window.SKINS пуст?)');
    await browser.close(); srv.close(); process.exit(2);
  }

  const report = [];
  for (const s of list) {
    await page.evaluate((id) => applySkin(id, false), s.id);
    await page.waitForTimeout(500);
    const views = await toggleAllTabs(page);
    const merged = mergeFindings(views);
    const errorsCount = merged.radius.length + merged.font.length;
    report.push({ skin: s.id, name: s.name, errors: errorsCount, merged, views: views.map(([t]) => t) });
  }

  await browser.close();
  srv.close();

  if (JSON_OUT) {
    console.log(JSON.stringify({ report, pageErrors: errors }, null, 2));
  } else {
    const limit = VERBOSE ? 999 : 8;
    let totalErrors = 0;
    for (const r of report) {
      const m = r.merged;
      totalErrors += r.errors;
      console.log('\n════ Оболочка «' + r.name + '» (' + r.skin + ')');
      console.log('  вкладок проверено: ' + r.views.length + ', правил покрытия: ' + (m.radius.length + m.chrome.length + ' находок'));
      const block = (title, arr, fmt) => {
        if (!arr.length) return;
        console.log('  ' + title + ' — ' + arr.length);
        for (const f of arr.slice(0, limit)) console.log('    • ' + fmt(f));
        if (arr.length > limit) console.log('    … и ещё ' + (arr.length - limit));
      };
      block('ОШИБКА · скругление не сброшено', m.radius, (f) => f.value + ' — ' + f.el);
      block('ОШИБКА · шрифт не подхвачен', m.font, (f) => f.font + ' — ' + f.el);
      block('предупреждение · панель без фаски', m.chrome, (f) => f.el + '  (' + f.bg + ')');
      block('инфо · цвет вне палитры', m.palette, (f) => f.el + '  (' + f.bg + ')');
      if (!m.radius.length && !m.font.length && !m.chrome.length && !m.palette.length) console.log('  чисто');
    }
    console.log('\n──────────────────────────────');
    console.log('Итог: ' + report.length + ' оболочк(и), ошибок: ' + totalErrors);
    if (errors.length) {
      console.log('Ошибки страницы: ' + errors.slice(0, 3).join(' | '));
    }
    console.log(totalErrors ? 'Статус: есть что чинить (код 1)' : 'Статус: чисто (код 0)');
  }

  process.exit(report.some((r) => r.errors) ? 1 : 0);
})().catch((e) => {
  console.error('Аудит упал:', e);
  process.exit(3);
});
