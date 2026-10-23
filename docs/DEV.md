# Локальная разработка Тапёра (без сборки на GitHub)

> ⚠️ Рабочие подробности: пути на моём ПК. Можно удалить — см. `docs/WORKING-DETAILS.md`.


Как запускать Тапёр прямо из исходников на компьютере владельца. Нужно, чтобы видеть правки за секунды и не собирать установщик после каждого изменения.

Проверено на ПК владельца 21.10.2026 (Windows 10 19045, Node 24, npm 11).

## Где лежит проект и как запустить

| Что | Где |
| --- | --- |
| Проект | `E:\Tapyor-player` |
| Запуск | ярлык на рабочем столе «Тапёр (из исходников)» → `E:\Tapyor-player\Запустить Тапёр.cmd` |
| Журнал работы | `C:\Users\user\AppData\Roaming\stream-player\log.txt` (папка закреплена `pinUserData`) |

Ярлык запускает `node_modules\electron\dist\electron.exe .`. Файл `.cmd` намеренно **без кириллицы**: cmd.exe читает bat-файлы в кодировке OEM (CP866), и русский текст в UTF-8 превращается в мусор, а строки — в попытки выполнить команды.

Чтобы проверить правки: закрыть плеер (трей → «Выход») и открыть ярлык заново. Правки `index.html` подхватываются при перезапуске окна, правки `main.js` — только при полном перезапуске процесса.

## Три ловушки, которые уже стоили времени

### 1. npm не устанавливает сам Electron

npm 11 не выполняет install-скрипты пакетов без явного разрешения и пишет:
`1 package has install scripts not yet covered by allowScripts: electron@33.2.0 (postinstall: node install.js)`.
После `npm install` бинарника нет, `electron .` падает. Лечится так:

```powershell
node node_modules\electron\install.js
```

Проверка: должен появиться `node_modules\electron\dist\electron.exe` (~188 МБ).
Альтернатива: `npm install-scripts approve electron` и повторить `npm install`.

### 2. Переменная ELECTRON_RUN_AS_NODE

В окружении этой среды стоит `ELECTRON_RUN_AS_NODE=1`. Тогда electron.exe работает как обычный Node и падает на первой строке `main.js`:

```
TypeError: Cannot set properties of undefined (setting 'themeSource')
```

Перед запуском переменную надо снимать: `Remove-Item Env:\ELECTRON_RUN_AS_NODE` (в bat — `set ELECTRON_RUN_AS_NODE=`). В ярлыке это уже сделано.

### 3. Папка с «запрещающими» правами — Electron падает молча

Если папку проекта перенести из рабочей папки ИИ-среды (там стоят ограничивающие ACE), она унаследует запрет `Все → DeleteSubdirectoriesAndFiles → Deny`. Симптом: electron.exe завершается с кодом `-2147483645` (`0x80000003`), иногда разово `0xc0000005` (нарушение доступа) в журнале событий Windows, **до** любой записи в log.txt. Тот же самый файл (хеши совпадают) из чистой папки работает.

Проверка прав и лечение:

```powershell
(Get-Acl 'E:\Tapyor-player').Access | Format-Table IdentityReference, FileSystemRights, AccessControlType
icacls 'E:\Tapyor-player' /reset /T /C /Q
```

Если сброс не помог — пересоздать папку начисто (`robocopy` в новую), потому что следы переноса остаются.

## Чего в локальном запуске нет

Ключи сервисов лежат в секретах GitHub и подставляются только при сборке. Поэтому локально **не работают**: вход в YouTube через браузер (`src/google-oauth.json`), Last.fm (`src/lastfm.json`), DonationAlerts (`src/da.json`). Самопроверка так и пишет: «refs:Last.fm без ключа».

Автообновление тоже не работает: `electron-updater` ищет релизы, а локальный запуск — не релиз.

Всё остальное — Яндекс, YouTube через движок, SoundCloud, Audius, плейлисты, волна, заказы, темы — работает как в собранной версии. Движок YouTube лежит в `resources\yt-dlp.exe` (скачивается вручную, в git не хранится).

## Сборка установщика

Только по команде владельца «собери». Порядок: поднять версию в `package.json` → записи в `TODO.md` → коммит в `main` → `gh workflow run build.yml --ref main -R alexshikaka/tapyor-player` → через ~10 минут релиз в Releases.

Локальная сборка (`npx electron-builder --win --dir`) на этом ПК не проходила: скачивание архива Electron в `%LOCALAPPDATA%\electron\Cache` блокировалось («Access is denied»), а шаг подписи падал на `app-builder.exe`. Для итераций это не нужно — хватает запуска из исходников.
