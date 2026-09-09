@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start Vector.ps1"
if errorlevel 1 pause
