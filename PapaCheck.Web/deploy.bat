@echo off
setlocal
REM 用法: deploy.bat [envId]
REM 默认环境: child-teacher-parent-d9aef9d2208
set ENV_ID=%1
if "%ENV_ID%"=="" set ENV_ID=child-teacher-parent-d9aef9d2208

REM 临时目录放系统 TEMP 下（用 %TEMP% 展开后的 Windows 绝对路径，无 .. 也无 /tmp 歧义；
REM 不放项目内，避免 tcb 上传后短暂握持项目内目录句柄，导致结尾清理失败）
set DEPLOY_TMP=%TEMP%\papacheck_web_deploy

rmdir /s /q "%DEPLOY_TMP%" 2>nul
mkdir "%DEPLOY_TMP%"

REM —— 白名单拷贝生产文件（绝不整目录 cp -r，避免把 node_modules 传上去）——
copy "%~dp0index.html" "%DEPLOY_TMP%\" >nul
copy "%~dp0admin.html" "%DEPLOY_TMP%\" >nul
copy "%~dp0login.html" "%DEPLOY_TMP%\" >nul
copy "%~dp0restore-session.html" "%DEPLOY_TMP%\" >nul
copy "%~dp0favicon.png" "%DEPLOY_TMP%\" >nul
xcopy "%~dp0css" "%DEPLOY_TMP%\css\" /E /I /Y >nul
xcopy "%~dp0js" "%DEPLOY_TMP%\js\" /E /I /Y >nul

REM —— 防污染：递归清除任何意外带入的依赖/测试/缓存/日志/备份 ——
for /d /r "%DEPLOY_TMP%" %%d in (node_modules __tests__ .vite tts_cache) do (
  if exist "%%d" rmdir /s /q "%%d"
)
del /s /q "%DEPLOY_TMP%\*.log" "%DEPLOY_TMP%\*.bak" "%DEPLOY_TMP%\*.test.js" 2>nul

tcb hosting deploy "%DEPLOY_TMP%" papacheck/app --env-id %ENV_ID%
set EXIT_CODE=%ERRORLEVEL%

REM 清理临时目录：tcb / 杀毒软件上传后会短暂握持目录句柄，rmdir 可能一次失败。
REM 进程内用 ping 延时重试最多 10 次（每次约 1s）；另起独立进程在 3 秒后兜底再删一次，
REM 确保本机不留残留临时目录（独立进程在 CI / 双击运行时生效；本沙箱会被杀，属正常）。
for /L %%i in (1,1,10) do (
  rmdir /s /q "%DEPLOY_TMP%" 2>nul
  if not exist "%DEPLOY_TMP%" goto :cleanup_done
  ping -n 2 127.0.0.1 >nul
)
:cleanup_done
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 3; Remove-Item -LiteralPath '%DEPLOY_TMP%' -Recurse -Force -ErrorAction SilentlyContinue"

exit /b %EXIT_CODE%
