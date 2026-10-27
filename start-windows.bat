@echo off
title Silent Metro Local Demo
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting Silent Metro local demo...
node server.js
pause
