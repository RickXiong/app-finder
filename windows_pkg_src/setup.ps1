$ErrorActionPreference = 'Stop'
$BASE = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host ''
Write-Host '=== App Query Tool - Setup ===' -ForegroundColor Cyan

# Detect Python
$pyCmd = $null
foreach ($cmd in @('py','python','python3')) {
    try {
        $ver = & $cmd --version 2>&1
        if ($ver -match 'Python 3') { $pyCmd = $cmd; break }
    } catch {}
}

if (-not $pyCmd) {
    Write-Host 'Python not found. Downloading Python 3.12.7...' -ForegroundColor Yellow
    $installer = "$env:TEMP\python-3.12.7-amd64.exe"
    Invoke-WebRequest -Uri 'https://mirrors.huaweicloud.com/python/3.12.7/python-3.12.7-amd64.exe' -OutFile $installer
    Write-Host 'Installing Python (silent)...' -ForegroundColor Yellow
    Start-Process -FilePath $installer -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_pip=1' -Wait
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('PATH','User')
    foreach ($cmd in @('py','python','python3')) {
        try {
            $ver = & $cmd --version 2>&1
            if ($ver -match 'Python 3') { $pyCmd = $cmd; break }
        } catch {}
    }
    if (-not $pyCmd) {
        Write-Host 'ERROR: Python install failed. Please reopen Start.bat after restarting.' -ForegroundColor Red
        pause; exit 1
    }
}

Write-Host "Python found: $pyCmd" -ForegroundColor Green

# Install dependencies
Write-Host 'Installing dependencies...' -ForegroundColor Cyan
& $pyCmd -m pip install flask requests beautifulsoup4 lxml openpyxl Pillow cryptography qrcode `
    -i https://mirrors.huaweicloud.com/repository/pypi/simple/ `
    --trusted-host mirrors.huaweicloud.com -q

# If autostart is enabled, refresh its target to THIS folder (user may have replaced the folder)
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$targetCmd = 'wscript.exe "' + (Join-Path $BASE 'background.vbs') + '"'
$legacyNames = @('AppQueryTool','AppFinder')
$hadAny = $false
foreach ($n in $legacyNames) {
    try {
        $v = (Get-ItemProperty -Path $runKey -Name $n -ErrorAction Stop).$n
        if ($v) { $hadAny = $true }
        if ($n -ne 'AppQueryTool') {
            Remove-ItemProperty -Path $runKey -Name $n -ErrorAction SilentlyContinue
        }
    } catch {}
}
if ($hadAny) {
    Set-ItemProperty -Path $runKey -Name 'AppQueryTool' -Value $targetCmd -Force
    Write-Host 'Auto-start path refreshed to this folder.' -ForegroundColor DarkGray
}

Write-Host 'Starting server...' -ForegroundColor Green
& $pyCmd "$BASE\launch.py"
