@echo off
set REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
reg delete "%REG_KEY%" /v AppQueryTool /f >nul 2>&1
reg delete "%REG_KEY%" /v AppFinder /f >nul 2>&1
echo Auto-start disabled.
pause
