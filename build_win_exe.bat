@echo off
cd /d "%~dp0"
echo ============================================
echo  App Finder - Windows EXE Builder
echo ============================================
echo.
echo [1/3] Installing required packages...
py -m pip install -q pyinstaller flask requests beautifulsoup4 openpyxl Pillow 2>nul
if errorlevel 1 (
    python -m pip install -q pyinstaller flask requests beautifulsoup4 openpyxl Pillow
)
echo     Done.
echo.
echo [2/3] Building EXE (this may take 1-3 minutes)...
py -m PyInstaller --noconfirm --onedir --noconsole ^
    --name "AppFinder" ^
    --add-data "templates;templates" ^
    --add-data "static;static" ^
    --hidden-import=openpyxl ^
    --hidden-import=PIL ^
    --hidden-import=PIL.Image ^
    --hidden-import=PIL.PngImagePlugin ^
    --hidden-import=PIL.JpegImagePlugin ^
    --collect-all=PIL ^
    main_win.py 2>build_log.txt
if errorlevel 1 (
    echo     Build FAILED. See build_log.txt for details.
    pause
    exit /b 1
)
echo     Done.
echo.
echo [3/3] Packaging output folder...
if exist "AppFinder_Win" rmdir /s /q "AppFinder_Win"
mkdir "AppFinder_Win"
xcopy /e /q "dist\AppFinder" "AppFinder_Win\" >nul
echo     Output: AppFinder_Win\AppFinder.exe
echo.
echo ============================================
echo  Build complete!
echo  Send the entire AppFinder_Win folder to users.
echo  They double-click AppFinder.exe to launch.
echo ============================================
echo.
pause
