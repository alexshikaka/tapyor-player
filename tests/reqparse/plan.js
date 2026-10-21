// Что Тапёр будет искать в каждом сообщении (без сети): node tests/reqparse/plan.js
const R = require('../../src/reqparse');
const fs = require('fs');
fs.readFileSync(__dirname + '/messages.txt', 'utf8').split('\n').filter(Boolean).forEach((m) => {
  const p = R.plan(m);
  console.log((p.signal.padEnd(6)) + ' | ' + m.slice(0, 70) + (p.queries.length ? '\n         → ' + p.queries.map((q) => q.query).join(' ‖ ') : '') + (p.links.length ? '\n         → ' + p.links.join(' ') : ''));
});
