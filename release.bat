@echo off
setlocal

set BUMP=%1
if "%BUMP%"=="" set BUMP=patch
if /I "%BUMP%"=="add_C" set BUMP=patch
if /I "%BUMP%"=="add_B" set BUMP=minor
if /I "%BUMP%"=="add_A" set BUMP=major

echo ========================================
echo  PapaCheck 发布流程
echo  版本递增: %BUMP%
echo ========================================
echo.

echo [1/3] 递增版本号...
python PapaCheck.Windows/bump_version.py %BUMP%
if %errorlevel% neq 0 exit /b %errorlevel%
echo.

echo [2/3] 构建 Android APK...
cd /d PapaCheck.Android
call flutter build apk --release
if %errorlevel% neq 0 exit /b %errorlevel%
cd /d %~dp0
echo.

echo [3/3] 打包 Windows EXE...
python PapaCheck.Windows/build_exe.py
echo.

echo ========================================
echo  发布完成! 输出文件:
echo    EXE: PapaCheck.Windows\dist\PapaCheck.exe
echo    APK: PapaCheck.Web\apk\PapaCheck-*.apk
echo ========================================
