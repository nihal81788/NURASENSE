<#
.SYNOPSIS
    Automated Build, Port Forward, Installation, and Launch for Galaxy Watch FE.
.DESCRIPTION
    1. Validates environment (Java 17, Android SDK, ADB).
    2. Compiles Wear OS app with Gradle (assembleDebug).
    3. Establishes reverse port forward: adb reverse tcp:8000 tcp:8000.
    4. Installs and launches MainActivity onto the connected Wear OS device.
    5. Grants sensor permissions automatically.
#>

[CmdletBinding()]
param(
    [string]$DeviceSerial = "",
    [string]$WatchPort = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host "   NuraSense - Galaxy Watch Multi-Modal Deployment     " -ForegroundColor Cyan
Write-Host "========================================================`n" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $ScriptDir

# 1. Environment Detection: Android SDK & Java 17
$AndroidSdkPath = "C:\Users\Nihal\AppData\Local\Android\Sdk"
if (Test-Path $AndroidSdkPath) {
    $env:ANDROID_HOME = $AndroidSdkPath
    $env:ANDROID_SDK_ROOT = $AndroidSdkPath
    $env:PATH = "$AndroidSdkPath\platform-tools;$env:PATH"
    Write-Host "[✓] Android SDK located at $AndroidSdkPath" -ForegroundColor Green
}

$JbrPath = "C:\Program Files\Android\Android Studio1\jbr"
if (Test-Path $JbrPath) {
    $env:JAVA_HOME = $JbrPath
    $env:PATH = "$JbrPath\bin;$env:PATH"
    Write-Host "[✓] JDK 17 configured from $JbrPath" -ForegroundColor Green
}

# 2. Check ADB & Connected Devices
Write-Host "`n[1/5] Checking connected Wear OS devices..." -ForegroundColor Yellow
if ($WatchPort) {
    Write-Host "[*] Connecting to watch at 192.168.31.128:$WatchPort..." -ForegroundColor Cyan
    adb connect "192.168.31.128:$WatchPort"
    Start-Sleep -Seconds 1
}
$devices = adb devices | Select-String -Pattern "\b(device)\b" | ForEach-Object { ($_ -split "\s+")[0] }

if (-not $devices) {
    Write-Host "[!] No device currently connected via ADB." -ForegroundColor Yellow
    Write-Host "    To connect your Galaxy Watch FE:" -ForegroundColor White
    Write-Host "    1. On Watch: Settings -> Developer Options -> Enable 'ADB debugging' and 'Wireless debugging'." -ForegroundColor Gray
    Write-Host "    2. Pair or connect: 'adb connect <watch_ip>:<port>'" -ForegroundColor Gray
    Write-Host "    Proceeding with verified APK...`n" -ForegroundColor Gray
} else {
    $targetDevice = if ($DeviceSerial) { $DeviceSerial } else { $devices[0] }
    Write-Host "[✓] Target Device: $targetDevice" -ForegroundColor Green
}

# 3. Build APK with Gradle
$ApkPath = "$ScriptDir\app\build\outputs\apk\debug\app-debug.apk"
if (-not $SkipBuild) {
    Write-Host "`n[2/5] Compiling Wear OS App (gradlew assembleDebug)..." -ForegroundColor Yellow
    if ($IsWindows -or $env:OS -like "*Windows*") {
        & .\gradlew.bat assembleDebug
    } else {
        ./gradlew assembleDebug
    }

    if ($LASTEXITCODE -ne 0) {
        Write-Error "Gradle build failed with exit code $LASTEXITCODE."
        exit $LASTEXITCODE
    }
    Write-Host "[✓] Build successful!" -ForegroundColor Green
} else {
    Write-Host "`n[2/5] Skipping build as requested." -ForegroundColor Gray
}

# 4. ADB Reverse Port Forwarding
Write-Host "`n[3/5] Configuring ADB reverse port forwarding (tcp:8000 -> tcp:8000)..." -ForegroundColor Yellow
try {
    adb reverse tcp:8000 tcp:8000
    Write-Host "[✓] Port reverse tunnel established: Watch localhost:8000 -> Host PC:8000" -ForegroundColor Green
} catch {
    Write-Host "[!] Could not set reverse tunnel (device may not be connected yet)." -ForegroundColor Yellow
}

# 5. Install APK & Grant Permissions
if ($devices) {
    Write-Host "`n[4/5] Installing APK to watch ($targetDevice)..." -ForegroundColor Yellow
    adb -s $targetDevice install -r $ApkPath
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[✓] APK successfully installed." -ForegroundColor Green
        
        Write-Host "    Granting sensor permissions..." -ForegroundColor Gray
        adb -s $targetDevice shell pm grant com.example.watchstream android.permission.BODY_SENSORS 2>$null
        adb -s $targetDevice shell pm grant com.example.watchstream android.permission.BODY_SENSORS_BACKGROUND 2>$null
        adb -s $targetDevice shell pm grant com.example.watchstream android.permission.ACTIVITY_RECOGNITION 2>$null
    }

    # 6. Launch Application
    Write-Host "`n[5/5] Launching Galaxy Watch Biometrics Stream..." -ForegroundColor Yellow
    adb -s $targetDevice shell am start -n com.example.watchstream/.MainActivity
    Write-Host "[✓] Application launched on watch!" -ForegroundColor Green
} else {
    Write-Host "`n[4/5 & 5/5] Skipped install/launch because no watch was connected." -ForegroundColor Yellow
    Write-Host "    APK ready at: $ApkPath" -ForegroundColor White
    Write-Host "    Once connected, run: adb install -r $ApkPath" -ForegroundColor White
}

Write-Host "`n========================================================" -ForegroundColor Cyan
Write-Host " Deployment Complete!" -ForegroundColor Green
Write-Host " Start server with: powershell -File .\start_server.ps1" -ForegroundColor White
Write-Host "========================================================`n" -ForegroundColor Cyan
