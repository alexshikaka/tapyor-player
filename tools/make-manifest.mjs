// Сборка MANIFEST.json для снимка релиза.
// Запуск: node tools/make-manifest.mjs 0.19.1 [--status local|published]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
if (!version) { console.error('Укажи версию: node tools/make-manifest.mjs 0.19.1'); process.exit(2); }
const statusArg = process.argv.indexOf('--status');
const status = statusArg > 0 ? process.argv[statusArg + 1] : 'local';
const dir = path.join(root, 'docs/releases/v' + version);
if (!fs.existsSync(dir)) { console.error('Нет папки ' + dir); process.exit(2); }
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    if (f === 'MANIFEST.json') continue;
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else files.push({ path: path.relative(path.join(root, 'docs/releases'), p).replace(/\\/g, '/'), bytes: st.size, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 16) });
  }
})(dir);
let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim(); } catch {}
fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify({ version, date: new Date().toISOString().slice(0, 10), sourceCommit: commit, status, files }, null, 2) + '\n', 'utf8');
console.log('manifest:', files.length, 'files,', commit, status);
