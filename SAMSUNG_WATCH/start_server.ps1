<#
.SYNOPSIS
    Starts the FastAPI Telemetry Server and opens the Dashboard.
#>

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

Write-Host "`n[1/3] Ensuring ADB reverse tunnel is active (tcp:8000 -> tcp:8000)..." -ForegroundColor Yellow
try {
    adb reverse tcp:8000 tcp:8000 2>$null
    Write-Host "[✓] ADB reverse tunnel confirmed." -ForegroundColor Green
} catch {
    Write-Host "[!] Note: Watch not connected via ADB yet (run adb reverse once connected)." -ForegroundColor Gray
}

Write-Host "`n[2/3] Launching web browser for dashboard..." -ForegroundColor Yellow
Start-Process "http://localhost:8000"

Write-Host "`n[3/3] Starting FastAPI Biometrics Server on port 8000..." -ForegroundColor Green
python server.py

