' Runs the nightly backup with no console window popping up.
' Used by the "Catalog Backup" scheduled task.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\BlurA\Desktop\catalog"
shell.Run """C:\Program Files\nodejs\node.exe"" scripts\backup.mjs", 0, False
