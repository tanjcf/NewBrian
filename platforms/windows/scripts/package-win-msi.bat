@echo off
setlocal

REM Double-click friendly MSI packager for codeCN (Windows)
REM - Builds desktop (electron-vite)
REM - Packages MSI (electron-builder)

set SCRIPT_DIR=%~dp0
set WINDOWS_ROOT=%SCRIPT_DIR%..

echo [codeCN] Packaging MSI...
echo [codeCN] Windows root: %WINDOWS_ROOT%

powershell -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT_DIR%package-win-msi.ps1"
set EXITCODE=%ERRORLEVEL%

if NOT "%EXITCODE%"=="0" (
  echo.
  echo [codeCN] FAILED with exit code %EXITCODE%
  echo [codeCN] Press any key to close...
  pause >nul
  exit /b %EXITCODE%
)

echo.
echo [codeCN] Done.
echo [codeCN] Press any key to close...
pause >nul
exit /b 0

