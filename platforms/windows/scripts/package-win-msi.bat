@echo off
setlocal

REM Double-click friendly MSI packager for NewBrain (Windows)
REM - Builds desktop (electron-vite)
REM - Packages MSI (electron-builder)

set SCRIPT_DIR=%~dp0
set WINDOWS_ROOT=%SCRIPT_DIR%..

echo [NewBrain] Packaging MSI...
echo [NewBrain] Windows root: %WINDOWS_ROOT%

powershell -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT_DIR%package-win-msi.ps1"
set EXITCODE=%ERRORLEVEL%

if NOT "%EXITCODE%"=="0" (
  echo.
  echo [NewBrain] FAILED with exit code %EXITCODE%
  echo [NewBrain] Press any key to close...
  pause >nul
  exit /b %EXITCODE%
)

echo.
echo [NewBrain] Done.
echo [NewBrain] Press any key to close...
pause >nul
exit /b 0

