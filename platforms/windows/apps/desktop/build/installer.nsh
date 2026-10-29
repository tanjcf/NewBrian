; Force Test/production NSIS setups into the same authoritative root as MSI:
;   %LOCALAPPDATA%\.newbrain
; electron-builder's default (%LOCALAPPDATA%\Programs\@codex-forgedesktop) left
; Start Menu / Desktop shortcuts on the MSI tree while the setup wrote a second
; install — the user kept launching 1.4.18 after installing 1.4.20-setup.
;
; In-app updates already pass /D=<dirname(exe)> (and --updated /S). This file also
; force-kills a still-running historical install so replace cannot fail on locks.
;
; Keep this file free of LogicLib macros (${If}/${FileExists}) so it works with
; electron-builder's stock NSIS header set.
;
; Never use ExecWait cmd.exe here — each call flashes a black console on upgrade.

!macro silentKillNewBrainProcesses
  ; nsExec hides the console (CREATE_NO_WINDOW); ExecWait cmd.exe does not.
  nsExec::ExecToStack 'taskkill /F /IM NewBrain.exe /T'
  Pop $R6
  Pop $R7
  nsExec::ExecToStack 'taskkill /F /IM newbrain.exe /T'
  Pop $R6
  Pop $R7
  nsExec::ExecToStack 'taskkill /F /IM brain-core.exe /T'
  Pop $R6
  Pop $R7
  Sleep 1500
!macroend

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
  !insertmacro silentKillNewBrainProcesses
!macroend

!macro customInit
  ; Always kill before choosing $INSTDIR / writing files (covers silent /S too).
  !insertmacro silentKillNewBrainProcesses
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

; --updated upgrades Rename files into %TEMP%\nsn*|nsm*|nss*\*.tmp\old-install.
; Windows Shell Link tracking can retarget Desktop/Start Menu .lnk at that temp
; tree; the stale copy can also hold the single-instance lock so the real
; install appears unable to open. Always force-rewrite shortcuts to $INSTDIR.
!macro customInstall
  StrCpy $R1 ""
  IfFileExists "$INSTDIR\NewBrain.exe" nsis_shortcut_product 0
  IfFileExists "$INSTDIR\newbrain.exe" nsis_shortcut_lower 0
  Goto nsis_shortcut_done
  nsis_shortcut_product:
    StrCpy $R1 "$INSTDIR\NewBrain.exe"
    Goto nsis_shortcut_write
  nsis_shortcut_lower:
    StrCpy $R1 "$INSTDIR\newbrain.exe"
  nsis_shortcut_write:
    CreateShortCut "$DESKTOP\NewBrain.lnk" "$R1" "" "$R1" 0
    CreateShortCut "$SMPROGRAMS\NewBrain.lnk" "$R1" "" "$R1" 0
  nsis_shortcut_done:
!macroend
