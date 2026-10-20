// Посредник для отчётов об ошибках Тапёра: Yandex Cloud Functions → GitHub Issues.
// Тапёр шлёт сюда короткий анонимный отчёт; функция находит задачу с тем же «отпечатком»
// и обновляет в ней счётчик, а новую создаёт, только если такой ещё нет.
// Переменные окружения: GITHUB_TOKEN (fine-grained, только Issues: Read & write), GITHUB_REPO (alexshikaka/tapyor-player).
// Среда выполнения: Node.js 18+ (есть fetch). Точка входа: index.handler

const GH = 'https://api.github.com';
const MAX_NEW_PER_DAY = 30;      // не больше 30 новых задач в сутки
const UPDATE_EVERY_MS = 10 * 60 * 1000; // счётчик в задаче обновляем не чаще раза в 10 минут (кроме новых пользователей)
const seen = new Map();          // память «экземпляра» функции: лимит 1 отчёт в минуту с одной установки
let day = '', newToday = 0;

const clip = (s, n) => String(s == null ? '' : s).slice(0, n);
// Убираем всё личное, даже если оно случайно попало в текст
function scrub(s) {
  return String(s || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/gi, 'C:\\Users\\…')
    .replace(/\/(home|Users)\/[^/\s]+/g, '/$1/…')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '…@…')
    .replace(/(token|cookie|sapisid|sid|auth|key|secret|password)[=:]\s*\S+/gi, '$1=…')
    .replace(/\b[A-Za-z0-9_\-]{32,}\b/g, '…');
}
function verCmp(a, b) { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
const STATS_RE = /<!--stats (\{[\s\S]*?\}) -->/;

async function gh(path, opts) {
  const r = await fetch(GH + path, Object.assign({}, opts, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'tapyor-report', 'Content-Type': 'application/json' } }));
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
  if (!r.ok && r.status !== 422) throw new Error('GitHub ' + r.status + ': ' + t.slice(0, 200));
  return j;
}
function body(rep, st) {
  return [
    '**Автоотчёт Тапёра.** Задача создана автоматически; одинаковые ошибки разных пользователей собираются сюда.',
    '',
    '| | |', '|---|---|',
    '| Площадка | ' + rep.service + ' |', '| Этап | ' + rep.stage + ' |', '| Код | `' + rep.code + '` |',
    '| Пользователей | ' + st.users.length + ' |', '| Всего отчётов | ' + st.count + ' |',
    '| Версии Тапёра | ' + st.versions.join(', ') + ' |', '| Рецепты | ' + st.recipes.join(', ') + ' |',
    '| Первый раз | ' + st.first + ' |', '| Последний раз | ' + st.last + ' |',
    '', '**Сообщение (последнее):**', '```', rep.msg, '```',
    rep.details ? '**Подробности:**\n```\n' + rep.details + '\n```' : '',
    '', 'Чтобы отчёты со старых версий не открывали задачу снова, при закрытии добавь метку `fixed-in-X.Y.Z`.',
    '<!--stats ' + JSON.stringify(st) + ' -->'
  ].join('\n');
}

exports.handler = async function (event) {
  const res = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  try {
    if ((event.httpMethod || 'POST') !== 'POST') return res(405, { error: 'POST only' });
    let raw = event.body || '';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    if (raw.length > 8000) return res(413, { error: 'too big' });
    const q = JSON.parse(raw || '{}');
    const rep = {
      fp: clip(q.fp, 16).replace(/[^a-z0-9]/gi, ''), service: clip(q.service, 20).replace(/[^\w.-]/g, ''), stage: clip(q.stage, 30).replace(/[^\w.-]/g, ''),
      code: scrub(clip(q.code, 40)), msg: scrub(clip(q.msg, 600)), details: scrub(clip(q.details, 1500)),
      app: clip(q.app, 12).replace(/[^\d.]/g, ''), recipes: clip(q.recipes, 8).replace(/[^\d]/g, ''), os: clip(q.os, 30).replace(/[^\w .-]/g, ''),
      iid: clip(q.iid, 40).replace(/[^\w-]/g, '')
    };
    if (!rep.fp || !rep.service || !rep.iid || !rep.app) return res(400, { error: 'bad report' });
    const now = Date.now();
    if (seen.get(rep.iid) > now - 60000) return res(429, { error: 'slow down' });
    seen.set(rep.iid, now); if (seen.size > 5000) seen.clear();
    const repo = process.env.GITHUB_REPO;
    const fpLabel = 'fp-' + rep.fp;
    const list = await gh('/repos/' + repo + '/issues?state=all&per_page=5&labels=' + encodeURIComponent(fpLabel));
    const issue = (list || []).find((i) => !i.pull_request);
    const stamp = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    const userHash = require('crypto').createHash('sha256').update(rep.iid).digest('hex').slice(0, 12);
    if (issue) {
      const fixed = (issue.labels || []).map((l) => l.name).find((n) => /^fixed-in-/.test(n));
      if (issue.state === 'closed' && fixed && verCmp(rep.app, fixed.slice(9)) < 0) {
        return res(200, { ok: true, known: true, fixed: fixed.slice(9), issue: issue.number }); // старая версия — уже исправлено
      }
      const m = STATS_RE.exec(issue.body || '');
      const st = m ? JSON.parse(m[1]) : { users: [], count: 0, versions: [], recipes: [], first: stamp, last: stamp, upd: 0 };
      const newUser = !st.users.includes(userHash);
      if (newUser && st.users.length < 1000) st.users.push(userHash);
      st.count++; st.last = stamp;
      if (rep.app && !st.versions.includes(rep.app)) st.versions = st.versions.concat(rep.app).slice(-12);
      if (rep.recipes && !st.recipes.includes(rep.recipes)) st.recipes = st.recipes.concat(rep.recipes).slice(-12);
      const reopen = issue.state === 'closed';
      if (newUser || reopen || now - (st.upd || 0) > UPDATE_EVERY_MS) {
        st.upd = now;
        await gh('/repos/' + repo + '/issues/' + issue.number, { method: 'PATCH', body: JSON.stringify(Object.assign({ body: body(rep, st) }, reopen ? { state: 'open' } : {})) });
      }
      return res(200, { ok: true, issue: issue.number, users: st.users.length });
    }
    const today = new Date(now).toISOString().slice(0, 10);
    if (day !== today) { day = today; newToday = 0; }
    if (newToday >= MAX_NEW_PER_DAY) return res(429, { error: 'daily limit' });
    newToday++;
    const st = { users: [userHash], count: 1, versions: [rep.app], recipes: rep.recipes ? [rep.recipes] : [], first: stamp, last: stamp, upd: now };
    const created = await gh('/repos/' + repo + '/issues', { method: 'POST', body: JSON.stringify({
      title: '[авто] ' + rep.service + ' / ' + rep.stage + ' / ' + rep.code,
      body: body(rep, st),
      labels: ['auto-report', fpLabel, 'svc-' + rep.service]
    }) });
    return res(200, { ok: true, issue: created && created.number, users: 1, created: true });
  } catch (e) {
    return res(500, { error: String(e.message || e).slice(0, 200) });
  }
};
