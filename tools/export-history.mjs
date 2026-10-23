// Выгрузка истории переписки из журнала DeepSeek Harness в history/.
// Запуск: node tools/export-history.mjs [--session <path>] [--out history]
// Ищет последнюю сессию в DSH_HOME/sessions, распаковывает zstd и собирает:
// history/COMPACT.md (кратко), history/DIGEST.md (средне), history/FULL.md (полностью).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outDir = path.resolve(root, arg('--out') || 'history');

function findSession() {
  const explicit = arg('--session');
  if (explicit) return explicit;
  const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh');
  const sessionsRoot = path.join(home, 'sessions');
  if (!fs.existsSync(sessionsRoot)) throw new Error('нет папки сессий: ' + sessionsRoot);
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else if (f === 'session.v4.jsonl.zstd') files.push({ p, mtime: st.mtimeMs });
    }
  };
  walk(sessionsRoot);
  if (!files.length) throw new Error('не найдено ни одного session.v4.jsonl.zstd');
  files.sort((a, b) => b.mtime - a.mtime);
  return files[0].p;
}

let sessionPath;
try {
  sessionPath = findSession();
} catch (e) {
  console.log('Журнал сессии DSH не найден: ' + e.message);
  console.log('history/ не изменена — используется существующая копия.');
  process.exit(0);
}
let raw;
try {
  raw = zlib.zstdDecompressSync(fs.readFileSync(sessionPath));
} catch (e) {
  console.log('Не удалось распаковать журнал: ' + e.message);
  console.log('history/ не изменена.');
  process.exit(0);
}
const lines = raw.toString('utf8').split('\n');

const events = [];
const seen = new Set();
for (const line of lines) {
  if (!line.trim()) continue;
  let o; try { o = JSON.parse(line); } catch { continue; }
  if (o.type === 'user/message' && o.data?.source?.kind === 'user') {
    const text = (o.data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (text) events.push({ role: 'user', time: o.time, text });
  } else if (o.type === 'assistant/message' && o.data?.message) {
    const text = (o.data.message.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (text) {
      const key = o.time + '|' + text.slice(0, 80);
      if (!seen.has(key)) { seen.add(key); events.push({ role: 'assistant', model: o.data.message.source?.model, time: o.time, text }); }
    }
  } else if (o.type === 'compaction/summary' && o.data?.summary) {
    const text = (o.data.summary || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    if (text) events.push({ role: 'summary', time: o.time, text });
  }
}
events.sort((a, b) => (a.time || 0) - (b.time || 0));

const secrets = [
  [/GOCSPX-[A-Za-z0-9_-]+/g, '<REDACTED_GOOGLE_CLIENT_SECRET>'],
  [/[0-9]{6,}-[a-z0-9]+\.apps\.googleusercontent\.com/g, '<REDACTED_GOOGLE_CLIENT_ID>'],
  [/github_pat_[A-Za-z0-9_]+/g, '<REDACTED_GITHUB_TOKEN>'],
  [/ghp_[A-Za-z0-9]{20,}/g, '<REDACTED_GITHUB_TOKEN>'],
  [/AIza[0-9A-Za-z_-]{30,}/g, '<REDACTED_GOOGLE_API_KEY>']
];
const clean = (s) => secrets.reduce((acc, [re, to]) => acc.replace(re, to), s);

const ts = (t) => { try { return new Date(t).toLocaleString('ru-RU', { timeZone: 'Europe/Kiev', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const clip = (s, n) => { s = s.replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

let full = '# История работы над «Тапёром» — полная переписка\n\nИсточник: журнал сессии DeepSeek Harness. Только диалог: сообщения владельца, ответы ассистента, конспекты сжатия.\n\n---\n\n';
for (const e of events) {
  const head = e.role === 'user' ? '## Владелец' : e.role === 'assistant' ? '## Ассистент' + (e.model ? ' (' + e.model + ')' : '') : '## Конспект сжатия';
  full += `${head}\n${e.time ? '*' + ts(e.time) + '*\n\n' : '\n'}${clean(e.text).trim()}\n\n---\n\n`;
}

let digest = '# История «Тапёра» — дайджест\n\n';
let compact = '# История «Тапёра» — краткий дайджест\n\n';
for (const e of events) {
  if (e.role === 'summary') {
    digest += '**Конспект:** ' + clip(clean(e.text), 1200) + '\n\n';
    compact += '**Конспект:** ' + clip(clean(e.text), 500) + '\n\n';
  } else if (e.role === 'user') {
    digest += '**Владелец:** ' + clip(clean(e.text), 900) + '\n\n';
    compact += '**Владелец:** ' + clip(clean(e.text), 300) + '\n\n';
  } else {
    digest += '**Ассистент:** ' + clip(clean(e.text), 450) + '\n\n';
    compact += '**Ассистент:** ' + clip(clean(e.text), 150) + '\n\n';
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'FULL.md'), full, 'utf8');
fs.writeFileSync(path.join(outDir, 'DIGEST.md'), digest, 'utf8');
fs.writeFileSync(path.join(outDir, 'COMPACT.md'), compact, 'utf8');

console.log(JSON.stringify({
  session: sessionPath,
  events: events.length,
  user: events.filter(e => e.role === 'user').length,
  assistant: events.filter(e => e.role === 'assistant').length,
  summaries: events.filter(e => e.role === 'summary').length,
  chars: { full: full.length, digest: digest.length, compact: compact.length }
}, null, 1));
