@echo off
chcp 65001 > nul
cd /d "%~dp0"

echo.
echo === PapaCheck Flutter ===
echo.

echo [1/3] Starting Android emulator...
start /b flutter emulators --launch pixel_6_api36 > nul 2>&1

echo [2/3] Waiting for emulator to boot...
:wait
timeout /t 3 > nul
adb -e get-state 2>nul | find "device" > nul
if errorlevel 1 (
  timeout /t 2 > nul
  goto wait
)
echo        Emulator is ready.

echo [3/3] Launching PapaCheck...
flutter run

pause