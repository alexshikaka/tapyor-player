@echo off
title Tapyor - run from source
set "PATH=C:\Program Files\nodejs;%PATH%"
set ELECTRON_RUN_AS_NODE=
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo   Electron is not installed. Ask the assistant to run: npm install
  pause
  exit /b 1
)

echo   Starting Tapyor...
echo.
node_modules\electron\dist\electron.exe .
echo.
echo   Tapyor closed. Exit code: %ERRORLEVEL%
pause
