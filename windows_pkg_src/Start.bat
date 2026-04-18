@echo off
powershell -NoLogo -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 pause
