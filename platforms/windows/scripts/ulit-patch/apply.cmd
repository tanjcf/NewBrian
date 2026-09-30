@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Apply codeCN ulit patch (bsdiff of app.asar) using Electron-as-Node or system node.
REM Install root: CLI arg / CODECN_INSTALL_ROOT / ARP / user-profile .codecn
REM ASCII-only .cmd (no UTF-8 BOM). Chinese diagnostics come from PowerShell/Node.
REM Never runs find.exe, where.exe crawls, or recursive filesystem search for codeCN.exe.
set "PATCH_ROOT=%~dp0"
if "%PATCH_ROOT:~-1%"=="\" set "PATCH_ROOT=%PATCH_ROOT:~0,-1%"

REM Plain path arg only (no ROOT=...). cmd.exe eats unquoted NAME=VALUE tokens.
REM Do NOT use %VAR:~-1% / %VAR:~0,-1% while VAR may be empty: cmd.exe exits 255
REM ("The syntax of the command is incorrect") before the IF guard runs.
set "REQUESTED_ROOT=%~1"
if "%REQUESTED_ROOT%"=="." set "REQUESTED_ROOT="
if "%REQUESTED_ROOT%"=="" if defined CODECN_INSTALL_ROOT set "REQUESTED_ROOT=%CODECN_INSTALL_ROOT%"
if defined REQUESTED_ROOT (
  if "!REQUESTED_ROOT:~-1!"=="." set "REQUESTED_ROOT=!REQUESTED_ROOT:~0,-1!"
  if "!REQUESTED_ROOT:~-1!"=="\" set "REQUESTED_ROOT=!REQUESTED_ROOT:~0,-1!"
)

set "RESOLVER=%PATCH_ROOT%\resolve-install-root.ps1"
if not exist "%RESOLVER%" (
  echo ERROR: missing resolve-install-root.ps1
  exit /B 2
)

set "INSTALL_ROOT="
for /f "usebackq delims=" %%I in (`powershell -NoProfile -ExecutionPolicy Bypass -File "%RESOLVER%" "%REQUESTED_ROOT%"`) do (
  set "INSTALL_ROOT=%%I"
)

if not defined INSTALL_ROOT (
  echo ERROR: could not resolve codeCN install root. See resolver output above.
  echo Log: %TEMP%\codecn-ulit-patch.log
  exit /B 2
)
if not exist "%INSTALL_ROOT%" (
  echo ERROR: install root does not exist: %INSTALL_ROOT%
  exit /B 2
)

set "EXE=%INSTALL_ROOT%\codeCN.exe"
if not exist "%EXE%" set "EXE=%INSTALL_ROOT%\codecn.exe"

echo Install root: %INSTALL_ROOT%
echo Stopping codeCN if running...
taskkill /F /IM codeCN.exe >NUL 2>&1
taskkill /F /IM codecn.exe >NUL 2>&1
ping 127.0.0.1 -n 3 >NUL

if exist "%EXE%" (
  set "ELECTRON_RUN_AS_NODE=1"
  set "ELECTRON_NO_ASAR=1"
  "%EXE%" "%PATCH_ROOT%\apply-ulit-patch.cjs" --patch-root "%PATCH_ROOT%" --install-root "%INSTALL_ROOT%"
  set "ERR=!ERRORLEVEL!"
) else (
  where node >NUL 2>&1
  if errorlevel 1 (
    echo ERROR: codeCN.exe not found under install root, and node is unavailable.
    echo Install root: %INSTALL_ROOT%
    exit /B 2
  )
  node "%PATCH_ROOT%\apply-ulit-patch.cjs" --patch-root "%PATCH_ROOT%" --install-root "%INSTALL_ROOT%"
  set "ERR=!ERRORLEVEL!"
)

if not "!ERR!"=="0" (
  echo Patch failed with exit code !ERR!
  echo See %TEMP%\codecn-ulit-patch.log
  exit /B !ERR!
)

if exist "%EXE%" (
  echo Patch applied. Launching codeCN...
  start "" "%EXE%"
) else (
  echo Patch applied.
)
exit /B 0
