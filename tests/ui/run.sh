#!/bin/sh
# Проверки интерфейса в Chromium (Playwright). Окно Тапёра открывается как веб-страница с поддельным window.app (mock5.js).
# Нужно: python3 + playwright (pip install playwright && playwright install chromium).
cd "$(dirname "$0")"
[ -e app2 ] || ln -s ../../src app2
[ -e loud.wav ] || python3 gen_audio.py
for t in t9 t10 t11 t12 t13 t14 t15 t16; do echo "== $t"; python3 $t.py || exit 1; done
