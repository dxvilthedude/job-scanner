@echo off
title Azure Job Scanner
cd /d "%~dp0"
echo Uruchamiam Azure Job Scanner...
start "" http://localhost:4321
node server.js
pause
