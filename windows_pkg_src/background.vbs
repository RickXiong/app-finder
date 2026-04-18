Set WshShell = CreateObject("WScript.Shell")
Dim base : base = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
WshShell.Run "powershell -NoLogo -ExecutionPolicy Bypass -File """ & base & "setup.ps1""", 0, False
