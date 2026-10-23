# Проверки 0.19.1

- node --check src/main.js — 0.
- node --check скрипта index.html — 0.
- node --check скрипта zoom.html — 0.
- tests/skins/audit.js — 3 оболочки, 0 ошибок.
- Живой запуск — окно, окно масштаба, скины, ошибок нет.
- Сборка установщика: electron-builder 25.1.8, Electron 33.2.0, NSIS.
  - `dist/Tapyor-Setup-0.19.1.exe` — 119 241 946 байт.
  - `dist/Tapyor-Setup-0.19.1.exe.blockmap`, `dist/latest.yml` — есть.
  - Подпись пропущена (сертификата нет).
