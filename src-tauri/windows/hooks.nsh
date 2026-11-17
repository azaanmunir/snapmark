; SnapMark installer hooks (Tauri NSIS).
; Versions up to 0.1.x were Electron apps (electron-builder, appId com.azaan.snapmark). Remove that copy so two
; SnapMarks don't fight over the hotkey. Settings in %APPDATA%\SnapMark are kept and used by this version.
; electron-builder records the folder the user picked under HKCU|HKLM\Software\<appId GUID>\InstallLocation.
!define SNAPMARK_ELECTRON_KEY "Software\6532855f-4a2c-56f4-a69a-46e01ec48b67"

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $R7 HKCU "${SNAPMARK_ELECTRON_KEY}" "InstallLocation"
  StrCmp $R7 "" 0 +2
    ReadRegStr $R7 HKLM "${SNAPMARK_ELECTRON_KEY}" "InstallLocation"
  StrCmp $R7 "" 0 +2
    StrCpy $R7 "$LOCALAPPDATA\Programs\SnapMark"
  IfFileExists "$R7\Uninstall SnapMark.exe" 0 snapmark_no_electron
    DetailPrint "Removing the previous SnapMark (Electron) version from $R7 ..."
    nsExec::Exec 'taskkill /F /IM "SnapMark.exe"'
    Pop $0
    Sleep 500
    ExecWait '"$R7\Uninstall SnapMark.exe" /currentuser /S _?=$R7'
    Delete "$R7\Uninstall SnapMark.exe"
    RMDir "$R7"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.SnapMark"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.azaan.snapmark"
  snapmark_no_electron:
!macroend
