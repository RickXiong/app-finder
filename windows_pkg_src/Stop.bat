@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":9527" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a
    echo Stopped PID %%a
)
echo Done.
pause
