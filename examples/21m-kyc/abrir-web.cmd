@echo off
setlocal
title 21Millions - Laboratorio de APIs
set "LAB_DIR=%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js. Instala Node 24 y volve a abrir este archivo.
  pause
  exit /b 1
)
if exist "%LAB_DIR%launch.mjs" goto launch
rem Un worktree anterior puede usar el laboratorio actualizado del checkout principal.
for /f "delims=" %%G in ('git -C "%~dp0." rev-parse --path-format^=absolute --git-common-dir 2^>nul') do set "LAB_COMMON_GIT=%%G"
if not defined LAB_COMMON_GIT goto missing
for %%L in ("%LAB_COMMON_GIT%\..\examples\21m-kyc") do set "LAB_DIR=%%~fL\"
:launch
if not exist "%LAB_DIR%launch.mjs" goto missing
node "%LAB_DIR%launch.mjs" "%~dp0."
set "LAB_EXIT=%ERRORLEVEL%"
pause
exit /b %LAB_EXIT%
:missing
echo No se encuentra el laboratorio actualizado. Abri examples\21m-kyc\abrir-web.cmd desde la rama 21millon.
pause
exit /b 1
