// Проверка готовности релиза: node tools/release-preflight.mjs 0.19.1
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const version = process.argv[2];
if (!version) { console.error('Укажи версию: node tools/release-preflight.mjs 0.19.1'); process.exit(2); }

const results = [];
const add = (ok, name, hint = '') => results.push({ ok, name, hint });
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return ''; } };

// 1. файлы снимка
const dir = `docs/releases/v${version}`;
for (const f of ['README.md', 'CHANGES.md', 'DECISIONS.md', 'ERRORS.md', 'VERIFICATION.md', 'AUDIT.md', 'SESSION.md', 'MANIFEST.json']) {
  add(exists(`${dir}/${f}`), `снимок: ${dir}/${f}`);
}
for (const f of ['HANDOFF.md', 'DEV.md', 'CHECKS.md']) {
  add(exists(`${dir}/docs/${f}`), `копия в снимке: ${dir}/docs/${f}`);
}

// 2. индекс и версия
add(read('docs/releases/INDEX.md').includes(version), `INDEX.md упоминает ${version}`);
try {
  const pkg = JSON.parse(read('package.json'));
  add(pkg.version === version, `package.json version = ${version}`, `сейчас ${pkg.version}`);
} catch { add(false, 'package.json читается'); }

// 2.5. согласованность версии в CURRENT и HANDOFF
const cur = read('docs/CURRENT.md');
const hand = read('docs/HANDOFF.md');
const verRe = new RegExp('\\*\\*Версия:\\*\\*\\s*' + version.replace(/\./g, '\\.'));
add(verRe.test(cur), 'CURRENT.md: **Версия:** ' + version);
const handRe = new RegExp('версия\\s+`?' + version.replace(/\./g, '\\.') + '\\b');
add(handRe.test(hand), 'HANDOFF.md: версия ' + version);

// 3. история
add(exists('history/COMPACT.md'), 'history/COMPACT.md');
const hist = read('history/COMPACT.md');
add(hist.length > 1000, 'history/COMPACT.md не пустой');
// аудит перед релизом
let auditFresh = false;
try {
  const auditDir = path.join(root, 'docs/audits');
  for (const f of fs.readdirSync(auditDir)) {
    if (f === 'README.md' || !f.endsWith('.md')) continue;
    const st = fs.statSync(path.join(auditDir, f));
    if (Date.now() - st.mtimeMs < 30 * 24 * 3600 * 1000) auditFresh = true;
  }
} catch {}
add(auditFresh, 'есть свежий отчёт аудита в docs/audits/', 'проведи аудит по docs/AUDIT.md');const today = new Date().toISOString().slice(0, 10);
add(fs.readdirSync(path.join(root, 'docs/sessions')).some(f => f.startsWith(today)), `карточка сессии за ${today}`);

// 4. TODO
add(read('TODO.md').includes(version) || read('TODO.md').includes('релиз'), 'TODO.md упоминает релиз');

// 5. секреты
const secretPatterns = [/GOCSPX-[A-Za-z0-9_-]{10,}/, /github_pat_[A-Za-z0-9_]{20,}/, /ghp_[A-Za-z0-9]{20,}/, /AIza[0-9A-Za-z_-]{30,}/];
let secretHit = null;
function walk(dirPath) {
  for (const f of fs.readdirSync(dirPath)) {
    const p = path.join(dirPath, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!/node_modules|\.git/.test(p)) walk(p); continue; }
    if (!/\.(md|json|txt|js|mjs|yml|yaml)$/.test(f)) continue;
    if (st.size > 5_000_000) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const re of secretPatterns) {
      const m = text.match(re);
      if (m) { secretHit = `${path.relative(root, p)}: ${m[0].slice(0, 12)}…`; return; }
    }
  }
}
walk(path.join(root, 'docs'));
walk(path.join(root, 'history'));
add(!secretHit, 'в docs/history нет значений ключей', secretHit || '');

// 6. git
try {
  const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' }).trim();
  add(!status, 'git status чистый', status.split('\n').slice(0, 3).join('; '));
} catch { add(false, 'git доступен'); }

console.log(`Проверка релиза ${version}\n`);
let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : r.hint ? ' — ' + r.hint : ''}`);
  if (!r.ok) failed++;
}
console.log(`\nИтого: ${results.length - failed} из ${results.length} в порядке.`);
if (failed) { console.log('Релиз не готов: сначала заполни отмеченные пункты (docs/RELEASE-CHECKLIST.md).'); process.exit(1); }
console.log('Всё готово. Публиковать можно только по команде владельца.');
