@echo off
chcp 65001 >nul
set "PAPERCARD_HOME=%~dp0"
start "" "%~dp0release\PaperCardAtelier\PaperCardAtelier.exe" %*
