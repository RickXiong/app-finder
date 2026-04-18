@echo off
set REG_KEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Run
reg delete "%REG_KEY%" /v AppFinder /f >nul 2>&1
set VBS="%~dp0background.vbs"
reg add "%REG_KEY%" /v AppQueryTool /t REG_SZ /d "wscript.exe %VBS%" /f >nul
echo Auto-start enabled.
pause
