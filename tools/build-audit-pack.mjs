// Сборка пакета для аудита при смене модели.
// Запуск: node tools/build-audit-pack.mjs [--out=C:\tapyor-audit-pack] [--with-todo] [--with-history] [--with-full] [--with-code]
// По умолчанию: документы, git log, карта файлов, main.js/preload/zoom, без тяжёлой истории.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const outArg = args.find(a => a.startsWith('--out='));
const out = outArg ? path.resolve(outArg.slice(6)) : 'C:\\tapyor-audit-pack';

const docs = [
  'docs/START-HERE.md',
  'docs/CURRENT.md',
  'docs/HANDOFF.md',
  'docs/DEV.md',
  'docs/DECISIONS.md',
  'docs/ERRORS.md',
  'docs/AUDIT.md',
  'docs/TRANSFER-STRATEGY.md',
  'docs/releases/INDEX.md',
  'docs/releases/ARCHIVE.md',
  'docs/audits/README.md',
  'docs/sessions/README.md',
  'docs/BRIEF-OPUS.md'
];
const sessionDir = path.join(root, 'docs/sessions');
if (fs.existsSync(sessionDir)) {
  for (const f of fs.readdirSync(sessionDir)) {
    if (/^\d{4}-\d{2}-\d{2}.*\.md$/.test(f)) docs.push('docs/sessions/' + f);
  }
}
if (opt('--with-todo')) docs.push('TODO.md');

const code = ['src/main.js', 'src/preload.js', 'src/zoom.html', 'src/zoom-preload.js'];
const historyDir = 'C:\\tapyor-handoff\\history';
const history = [];
if (opt('--with-history')) history.push(path.join(historyDir, 'COMPACT.md'));
if (opt('--with-full')) history.push(path.join(historyDir, 'DIGEST.md'), path.join(historyDir, 'FULL.md'));

function readChars(p) { try { return fs.readFileSync(p, 'utf8').length; } catch { return 0; } }
function est(chars) {
  if (!chars) return '—';
  const lo = Math.round(chars / 3 / 100) / 10;
  const hi = Math.round(chars / 2.5 / 100) / 10;
  return `${lo}–${hi} тыс.`;
}
function copyInto(src, rel) {
  const dst = path.join(out, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return readChars(dst);
}

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let total = 0;
const rows = [];
for (const rel of docs) {
  const src = path.join(root, rel);
  if (!fs.existsSync(src)) continue;
  const chars = copyInto(src, rel);
  total += chars;
  rows.push([rel, chars, est(chars)]);
}
for (const src of history) {
  if (!fs.existsSync(src)) continue;
  const rel = 'history/' + path.basename(src);
  const chars = copyInto(src, rel);
  total += chars;
  rows.push([rel, chars, est(chars)]);
}

// карта кода
const srcDir = path.join(root, 'src');
const inv = [];
for (const f of fs.readdirSync(srcDir)) {
  const p = path.join(srcDir, f);
  if (!fs.statSync(p).isFile()) continue;
  const text = fs.readFileSync(p, 'utf8');
  inv.push({ file: 'src/' + f, lines: text.split('\n').length, chars: text.length, tokens: est(text.length) });
}
if (opt('--with-code')) {
  for (const rel of code) {
    const src = path.join(root, rel);
    if (!fs.existsSync(src)) continue;
    const chars = copyInto(src, rel);
    total += chars;
    rows.push([rel, chars, est(chars)]);
  }
}

// git log и статус
let gitLog = '';
try {
  gitLog = execSync('git log -40 --oneline --decorate', { cwd: root, encoding: 'utf8' });
} catch (e) { gitLog = 'git недоступен\n'; }
fs.writeFileSync(path.join(out, 'git-log.txt'), gitLog, 'utf8');

// якоря index.html
let anchors = '';
try {
  const html = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8').split('\n');
  const marks = ['// Очередь', '// Волна', '// Масштаб', '// Единые подсказки', '// Перемотка', '// Заказы', '<style>', '</style>'];
  const found = [];
  html.forEach((line, i) => { for (const m of marks) if (line.includes(m)) found.push(`${i + 1}: ${line.trim().slice(0, 100)}`); });
  anchors = found.join('\n');
} catch (e) {}
fs.writeFileSync(path.join(out, 'index-anchors.txt'), anchors, 'utf8');

const index = `# Пакет для полного аудита «Тапёра»

Собран: ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Kiev' })}
Коммит: ${gitLog.split('\n')[0] || '—'}

## Как использовать

1. Прочитай \`docs/AUDIT.md\` — там три прохода и формат отчёта.
2. Затем \`docs/START-HERE.md\` → \`docs/CURRENT.md\` → \`docs/HANDOFF.md\` → \`docs/DEV.md\` → \`docs/DECISIONS.md\` → \`docs/ERRORS.md\`.
3. Отчёт пиши в \`docs/audits/ГГГГ-ММ-ДД-модель.md\` по шаблону \`docs/audits/README.md\`.
4. Ничего не публикуй, не меняй версию и \`appId\`.
5. Если контекст кончается — сохрани отчёт и продолжи следующим проходом.

## Состав и объём

| Файл | Знаков | ≈ токенов |
|---|---:|---:|
${rows.map(r => `| \`${r[0]}\` | ${r[1].toLocaleString('ru-RU')} | ${r[2]} |`).join('\n')}
| **Итого документов** | **${total.toLocaleString('ru-RU')}** | **${est(total)}** |

## Карта кода

| Файл | Строк | Знаков | ≈ токенов |
|---|---:|---:|---:|
${inv.map(r => `| \`${r.file}\` | ${r.lines} | ${r.chars.toLocaleString('ru-RU')} | ${r.tokens} |`).join('\n')}

\`src/index.html\` целиком в контекст не грузить: якоря — в \`index-anchors.txt\`.

## Быстрый промпт

> Прочитай docs/AUDIT.md и docs/START-HERE.md. Проведи полный аудит тремя проходами по плану. Отчёт — в docs/audits/ГГГГ-ММ-ДД-модель.md. Ничего не публикуй, версию и appId не менять. Если контекст кончается — сохрани отчёт и продолжи.
`;
fs.writeFileSync(path.join(out, 'README.md'), index, 'utf8');

console.log(JSON.stringify({ out, docs: rows.length, totalChars: total, estimate: est(total) }, null, 1));
