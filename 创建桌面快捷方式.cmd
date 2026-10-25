@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\PaperCardAtelier.lnk'); $s.TargetPath = '%~dp0release\PaperCardAtelier\PaperCardAtelier.exe'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0src\renderer\assets\papercard-icon.ico'; $s.Description = 'PaperCard Atelier 纸质笔记重新构建工作台'; $s.Save(); Write-Host '已在桌面创建快捷方式: PaperCardAtelier.lnk'"
