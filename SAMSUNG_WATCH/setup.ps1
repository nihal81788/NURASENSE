<#
.SYNOPSIS
    One-click setup for the Samsung Galaxy Watch Biometrics Telemetry module.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  NuraSense Samsung Watch Telemetry - Setup Script      " -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Verify AAR
$aarPath = "$ScriptDir\app\libs\samsung-health-sensor-api-1.4.1.aar"
if (Test-Path $aarPath) {
    Write-Host "[✓] Samsung Health Sensor SDK AAR found ($((Get-Item $aarPath).Length) bytes)." -ForegroundColor Green
} else {
    Write-Error "[!] Missing $aarPath! Place samsung-health-sensor-api-1.4.1.aar into app/libs/"
}

# 2. Python Dependencies
Write-Host "`n[*] Installing Python backend dependencies..." -ForegroundColor Yellow
python -m pip install -r requirements.txt

# 3. Environment configuration
$env:ANDROID_HOME = "C:\Users\Nihal\AppData\Local\Android\Sdk"
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio1\jbr"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"

Write-Host "`n[✓] Environment ready. You can now build or deploy with:" -ForegroundColor Green
Write-Host "    .\deploy.ps1          (Compiles and deploys to watch)" -ForegroundColor White
Write-Host "    .\start_server.ps1    (Runs FastAPI server and opens UI)" -ForegroundColor White
Write-Host "    python test_stream.py (Runs mock 500 Hz stream test)" -ForegroundColor White

