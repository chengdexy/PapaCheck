@echo off
cd /d "%~dp0"

echo.
echo === PapaCheck（爸~检查！）===
echo.

python --version >nul 2>nul
if not errorlevel 1 goto run_python

py -3 --version >nul 2>nul
if not errorlevel 1 goto run_py3

python3 --version >nul 2>nul
if not errorlevel 1 goto run_python3

echo Python not found. Please install Python 3.
echo Download: https://www.python.org/downloads/
echo.
pause
exit /b 1

:run_python
python server.py
pause
exit /b 0

:run_py3
py -3 server.py
pause
exit /b 0

:run_python3
python3 server.py
pause
exit /b 0