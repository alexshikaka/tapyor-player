# Посредник отчётов об ошибках (Yandex Cloud Functions → GitHub Issues)

Тапёр отправляет сюда короткий анонимный отчёт (POST JSON: fp, service, stage, code, msg, details, app, recipes, os, iid).
Функция ищет задачу с меткой `fp-<отпечаток>`: есть — обновляет счётчик пользователей/версий в описании; нет — создаёт новую
(не больше 30 в сутки). Закрытая задача с меткой `fixed-in-X.Y.Z` не переоткрывается отчётами со старых версий.
Личное (пути, почта, ключи, длинные токены) вырезается и в программе, и здесь.

Развёртывание: Cloud Functions → новая функция → Node.js 18+ → ZIP (`yc-report.zip` = index.js + package.json) →
точка входа `index.handler`, таймаут 10 с, память 128 МБ → переменные `GITHUB_TOKEN` (fine-grained, только Issues: Read and write
на этот репозиторий) и `GITHUB_REPO=alexshikaka/tapyor-player` → сделать функцию публичной → адрес вида
`https://functions.yandexcloud.net/<id>` вписать в Тапёр (REPORT_URL в main.js).
