!macro customInit
  # electron-builder normally restores the previous installation folder from
  # INSTALL_REGISTRY_KEY. Fall back to Windows' uninstall registry when an
  # older installer left only uninstall metadata behind.
  StrCpy $R8 ""

  ${If} $installMode == "all"
    ReadRegStr $R8 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R8 == ""
      ReadRegStr $R8 HKLM "${UNINSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
  ${Else}
    ReadRegStr $R8 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R8 == ""
      ReadRegStr $R8 HKCU "${UNINSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
  ${EndIf}

  ${If} $R8 != ""
  ${AndIf} ${FileExists} "$R8\${APP_EXECUTABLE_FILENAME}"
    StrCpy $INSTDIR "$R8"
  ${EndIf}
!macroend
