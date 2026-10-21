// Проверка вердиктов на сообщениях владельца с придуманной выдачей поиска: node tests/reqparse/judge.js
const R = require('../../src/reqparse');
const T = (author, title, seconds, extra) => Object.assign({ author, title, seconds: seconds || 200 }, extra || {});
const cases = [
  ['Король и ШутКороль и Шут - Счастье? (Ария Тодда)', T('Король и Шут', 'Счастье?'), 'exact'],
  ['Отличного настроения!!!! The Blasters- dark night', T('The Blasters', 'Dark Night'), 'exact'],
  ['Madk1d-Martin rose немного молодежной музыки для игры', T('MADK1D', 'Martin Rose'), 'exact'],
  ['The Final Countdown - Europe', T('Europe', 'The Final Countdown'), 'exact'],
  ['рано очищаться Ameno - Erа', T('Era', 'Ameno'), 'exact'],
  ['о Великая Русь державная - Хор Иона Дамаскина', T('Хор Иоанна Дамаскина', 'О, Русь державная'), 'exact'],
  ['Цесаревич - Хор Иоана Дамаскина', T('Хор Иоанна Дамаскина', 'Цесаревич'), 'exact'],
  ['поставь кино кукушку плиз', T('Кино', 'Кукушка'), 'exact'],
  ['включи песню про кукушку', T('Полина Гагарина', 'Кукушка'), 'doubt'],
  ['EPIC Calypso', T('Calypso', 'Epic'), 'exact'],
  ['Выкати пожалуйста Исакова И Москву', T('Uma2rman', 'Москва'), 'doubt'],
  ['Спасибо за стрим, хорошего вечера!', T('Ирина Аллегрова', 'Хороший вечер'), 'none'],
];
let ok = 0;
cases.forEach(([m, t, want]) => { const j = R.judge(m, t); const pass = j.level === want; ok += pass; console.log((pass ? 'OK  ' : 'FAIL') + ' ' + j.level.padEnd(5) + ' (ждали ' + want + ') ' + m.slice(0, 50) + ' ⇒ ' + t.author + ' — ' + t.title); });
console.log('флажки:', JSON.stringify(R.flags(T('Сборник', 'Лучшее за 2000-е', 3735), 'поставь', { maxSec: 420, stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('Artist', 'Song (Sped Up)', 150, { explicit: true }), 'Artist - Song', { stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('X', 'Pride Anthem', 180), 'X - Pride Anthem', { stopWords: R.DEFAULT_STOP })), JSON.stringify(R.flags(T('Gamer', 'Обзор корабля Фрем', 600), 'Фрем', { stopWords: R.DEFAULT_STOP })));
console.log(ok + '/' + cases.length);
process.exit(ok === cases.length ? 0 : 1);
