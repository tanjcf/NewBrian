@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0platforms\windows\scripts\package-test-msi.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Test MSI packaging FAILED. Exit code: %RESULT%
if "%RESULT%"=="0" echo Test MSI packaging completed.
pause
exit /b %RESULT%
