; A portable launcher, supplied through electron-builder's supported nsis.script.
; No installer actions, registry writes, plugins or shared extraction directories.
;
; NSIS 3.04's plugin allocator deletes its GetTempFileName reservation before
; creating a directory. Concurrent processes can then obtain the same name.
; Keep our reservation file until the child exits AND our directory is removed.
; Native File extraction and FileFunc.GetParameters do not initialize plugins.

!include "FileFunc.nsh"

!ifndef APP_64
  !error "The portable launcher requires the Windows x64 package."
!endif
!ifdef APP_32
  !error "The portable launcher must contain only the Windows x64 package."
!endif
!ifdef APP_ARM64
  !error "The portable launcher must contain only the Windows x64 package."
!endif

Name "${PRODUCT_NAME}"
BrandingText "${PRODUCT_NAME} ${VERSION}"
Icon "${MUI_ICON}"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
WindowIcon off
ShowInstDetails nevershow
CRCCheck on
FileBufSize 64
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"

Var reservation
Var runtimeRoot
Var ownsRuntime
Var parameters
Var childExit

Function .onInit
  StrCpy $ownsRuntime "0"
  StrCpy $childExit "122"
  ClearErrors
  GetTempFileName $reservation
  IfErrors initFailed
  StrCmp $reservation "" initFailed

  ; The retained file prevents any other invocation from reserving this name.
  ; Refuse a pre-existing sibling instead of taking ownership or deleting it.
  StrCpy $runtimeRoot "$reservation.dir"
  IfFileExists "$runtimeRoot" initFailed
  IfFileExists "$runtimeRoot\*.*" initFailed
  ClearErrors
  CreateDirectory "$runtimeRoot"
  IfErrors initFailed
  StrCpy $ownsRuntime "1"
  StrCpy $INSTDIR "$runtimeRoot\app"
  Return

initFailed:
  Call CleanupRuntime
  SetErrorLevel 122
  Quit
FunctionEnd

Function CleanupRuntime
  ; Move the working directory outside the owned tree before removing it.
  SetOutPath "$EXEDIR"
  StrCmp $ownsRuntime "1" 0 cleanupReservation
  ClearErrors
  RMDir /r "$runtimeRoot"
  ; Keep the reservation if cleanup failed, including when a child still owns
  ; a file. A later launch must never reuse or remove that remaining runtime.
  IfErrors cleanupDone
  StrCpy $ownsRuntime "0"
cleanupReservation:
  StrCmp $reservation "" cleanupDone
  Delete "$reservation"
cleanupDone:
FunctionEnd

Function .onInstFailed
  Call CleanupRuntime
  SetErrorLevel $childExit
FunctionEnd

Section
  StrCpy $childExit "123"
  ClearErrors
  SetOutPath "$INSTDIR"
  IfErrors extractionFailed
  SetOverwrite on
  ; Embed the exact x64 application directly. No Nsis7z, copying through a
  ; plugin directory, fixed extraction path, or shell cleanup is involved.
  File /r "${PROJECT_DIR}\dist\win-unpacked\*.*"
  IfErrors extractionFailed
  IfFileExists "$INSTDIR\${PRODUCT_FILENAME}.exe" 0 extractionFailed
  IfFileExists "$INSTDIR\resources\app.asar" 0 extractionFailed

  ${GetParameters} $parameters
  ClearErrors
  ExecWait '"$INSTDIR\${PRODUCT_FILENAME}.exe" $parameters' $childExit
  IfErrors launchFailed
  Goto finished

extractionFailed:
  StrCpy $childExit "123"
  Goto finished
launchFailed:
  ; ExecWait leaves its output undefined if CreateProcess fails.
  StrCpy $childExit "124"
finished:
  Call CleanupRuntime
  SetErrorLevel $childExit
SectionEnd
