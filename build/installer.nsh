; Cadence keeps one Windows install identity via appId `dev.cadence.widget`.
; electron-builder derives the NSIS GUID from that id, so running this setup on a
; machine that already has Cadence upgrades that install in place instead of
; dropping a second copy beside it. Settings in %APPDATA%\cadence-ai are left
; alone (`deleteAppDataOnUninstall` is off).

!macro customHeader
!macroend
