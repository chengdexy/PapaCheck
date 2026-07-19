@echo off
setlocal
set ENV_ID=%1
set TMP=%~dp0..\_web_deploy

rmdir /s /q "%TMP%" 2>nul
mkdir "%TMP%"

copy "%~dp0index.html" "%TMP%\" >nul
copy "%~dp0admin.html" "%TMP%\" >nul
copy "%~dp0login.html" "%TMP%\" >nul
copy "%~dp0restore-session.html" "%TMP%\" >nul
copy "%~dp0favicon.png" "%TMP%\" >nul
xcopy "%~dp0css" "%TMP%\css\" /E /I /Y >nul
xcopy "%~dp0js" "%TMP%\js\" /E /I /Y >nul

tcb hosting deploy "%TMP%" papacheck/app --env-id %ENV_ID%
set EXIT_CODE=%ERRORLEVEL%

rmdir /s /q "%TMP%"
exit /b %EXIT_CODE%
