Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
exePath = baseDir & "\release\PaperCardAtelier\PaperCardAtelier.exe"
shell.CurrentDirectory = baseDir
shell.Run """" & exePath & """", 1, False
