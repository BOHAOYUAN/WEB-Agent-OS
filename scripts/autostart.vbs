Set sh = CreateObject("WScript.Shell")
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""E:\project\Web-OS-Agent\scripts\autostart.ps1""", 0, False
