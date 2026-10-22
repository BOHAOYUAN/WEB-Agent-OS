' Web-OS-Agent autostart launcher.
' Kept inside the repository so no path is hard-coded: the Startup folder holds
' a shortcut that points at this file, and the script resolves everything from
' its own location. Install steps: docs/autostart.md.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = fso.BuildPath(scriptDir, "autostart.ps1")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & ps1 & """", 0, False
