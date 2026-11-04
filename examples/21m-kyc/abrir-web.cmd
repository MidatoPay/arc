@echo off
cd /d "%~dp0"
start "" http://127.0.0.1:3210
node --env-file=.env web/server.mjs
pause
