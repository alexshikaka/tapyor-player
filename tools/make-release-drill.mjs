// Создаёт песочницу для теста «слепой релиз».
// Запуск: node tools/make-release-drill.mjs --version 0.19.2 --base 0.19.1 [--out C:\tapyor-drill]
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const get = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const version = get('--version');
const base = get('--base');
const out = path.resolve(get('--out', 'C:\\tapyor-drill'));
if (!version || !base) { console.error('Нужно: --version 0.19.2 --base 0.19.1'); process.exit(2); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// копия ветки без node_modules и .git
const tmpZip = path.join(process.env.TEMP || root, 'tapyor-drill.zip');
const ref = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root, encoding: 'utf8' }).trim();
execSync('git archive --format=zip -o "' + tmpZip + '" ' + ref, { cwd: root });
try {
  execSync('tar -xf "' + tmpZip + '" -C "' + out + '"');
} catch (e) {
  execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${out}' -Force"`);
}
fs.rmSync(tmpZip, { force: true });

// версия — базовая
const pkgPath = path.join(out, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.version = base;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// убрать целевую версию и отчёты аудита
fs.rmSync(path.join(out, 'docs/releases/v' + version), { recursive: true, force: true });
try {
  for (const f of fs.readdirSync(path.join(out, 'docs/audits'))) {
    if (f.endsWith('.md') && f !== 'README.md') fs.rmSync(path.join(out, 'docs/audits', f));
  }
} catch (e) {}

// очистить историю — модель должна собрать заново
for (const f of ['COMPACT.md', 'DIGEST.md', 'FULL.md']) {
  fs.rmSync(path.join(out, 'history', f), { force: true });
}

// свой git
execSync('git init -q', { cwd: out });
execSync('git add -A', { cwd: out });
execSync('git -c user.name=Drill -c user.email=drill@local commit -q -m "Песочница: слепой релиз ' + version + '"', { cwd: out });

console.log(JSON.stringify({
  out,
  version,
  base,
  packageVersion: pkg.version,
  releaseDirRemoved: !fs.existsSync(path.join(out, 'docs/releases/v' + version)),
  historyCleared: !fs.existsSync(path.join(out, 'history/COMPACT.md')),
  hint: 'Дай модели только фразу: «Собери релиз ' + version + '».'
}, null, 1));
