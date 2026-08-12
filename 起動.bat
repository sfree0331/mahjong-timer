@echo off
rem Mahjong Timer launcher (double-click to start)
cd /d "%~dp0"

rem If the server is already running, just open the browser
netstat -an | findstr ":8793" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 goto open

start "mahjong-timer-server" /min python -m http.server 8793
timeout /t 1 /nobreak >nul

:open
start "" http://localhost:8793
