@echo off
setlocal enableextensions

REM Quick Windows packaging helper (NSIS installer + portable).
REM Runs from anywhere; expects repo root at ...\windows\ (this script lives in windows\scripts\).

set "ROOT=%~dp0.."
set "ROOT=%ROOT:\=\\%"

REM Use local cache to avoid permission issues writing under user profile.
set "NPM_CONFIG_CACHE=%~dp0..\\.npm-cache"

REM Prefer pnpm if available, otherwise fall back to npm exec pnpm@10.
pushd "%~dp0.."

where pnpm >nul 2>nul
if %errorlevel%==0 (
  echo [NewBrain] Using pnpm from PATH...
  pnpm install --force --node-linker=hoisted || exit /b 1
  pnpm --filter @codex-forge/desktop build || exit /b 1
  pnpm --filter @codex-forge/desktop package:win || exit /b 1
) else (
  echo [NewBrain] pnpm not found. Using npm exec pnpm@10.0.0...
  where npm >nul 2>nul
  if not %errorlevel%==0 (
    echo [NewBrain] ERROR: npm not found in PATH.
    exit /b 1
  )
  npm exec --yes pnpm@10.0.0 -- pnpm install --force --node-linker=hoisted --reporter=append-only || exit /b 1
  npm exec --yes pnpm@10.0.0 -- pnpm --filter @codex-forge/desktop build || exit /b 1
  npm exec --yes pnpm@10.0.0 -- pnpm --filter @codex-forge/desktop package:win || exit /b 1
)

echo [NewBrain] Done. Outputs:
echo   %cd%\\apps\\desktop\\release\\NewBrain Installer.exe
echo   %cd%\\apps\\desktop\\release\\NewBrain Portable.exe

popd
endlocal

