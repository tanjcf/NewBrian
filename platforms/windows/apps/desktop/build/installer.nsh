; Force Test/production NSIS setups into the same authoritative root as MSI:
;   %LOCALAPPDATA%\.newbrain
; electron-builder's default (%LOCALAPPDATA%\Programs\@codex-forgedesktop) left
; Start Menu / Desktop shortcuts on the MSI tree while the setup wrote a second
; install — the user kept launching 1.4.18 after installing 1.4.20-setup.
;
; In-app updates already pass /D=<dirname(exe)> (Cockpit-style). This file also
; force-kills a still-running historical install so replace cannot fail on locks.
;
; Keep this file free of LogicLib macros (${If}/${FileExists}) so it works with
; electron-builder's stock NSIS header set.

!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\.newbrain"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\.newbrain"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\.newbrain"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\.newbrain"
!macroend

; Replace electron-builder's "app is running → Quit" check with a hard kill so
; one-click /S upgrades never abort when an older NewBrain is still open.
!macro customCheckAppRunning
  ExecWait 'cmd.exe /C taskkill /F /IM NewBrain.exe /T >NUL 2>NUL & taskkill /F /IM newbrain.exe /T >NUL 2>NUL & taskkill /F /IM brain-core.exe /T >NUL 2>NUL & ping -n 2 127.0.0.1 >NUL & exit /B 0'
!macroend

!macro customInit
  ; Always kill before choosing $INSTDIR / writing files (covers silent /S too).
  ExecWait 'cmd.exe /C taskkill /F /IM NewBrain.exe /T >NUL 2>NUL & taskkill /F /IM newbrain.exe /T >NUL 2>NUL & taskkill /F /IM brain-core.exe /T >NUL 2>NUL & ping -n 2 127.0.0.1 >NUL & exit /B 0'
  ; Prefer an existing NewBrain.exe tree (MSI or prior NSIS) over a fresh Programs path.
  ReadEnvStr $R0 NEWBRAIN_HOME
  StrCmp $R0 "" nsis_check_dot_newbrain 0
  IfFileExists "$R0\NewBrain.exe" nsis_use_newbrain_home nsis_check_dot_newbrain
  nsis_use_newbrain_home:
    StrCpy $INSTDIR "$R0"
    Goto nsis_install_dir_done
  nsis_check_dot_newbrain:
    StrCpy $INSTDIR "$LOCALAPPDATA\.newbrain"
  nsis_install_dir_done:
!macroend
