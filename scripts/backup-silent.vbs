' Runs the nightly backup with no console window popping up.
' Used by the "Catalog Backup" scheduled task.
'
' The third argument to Run is "wait until it finishes", and it used to be
' False. That made the task finish a fraction of a second after it started,
' whatever the backup went on to do — so Task Scheduler recorded success every
' night while nothing was written, and at 3am the machine was free to go back
' to sleep mid-backup because as far as Windows knew the job was done.
'
' Waiting also means the backup's own exit code reaches the task, so a failure
' shows up as a failure instead of a green tick.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\BlurA\Desktop\catalog"
code = shell.Run("""C:\Program Files\nodejs\node.exe"" scripts\backup.mjs", 0, True)
WScript.Quit code
