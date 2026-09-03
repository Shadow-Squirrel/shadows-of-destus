@echo off
rem Double-click this file to preview the site on your own PC.
cd /d "%~dp0"
start "" http://localhost:4173
"C:\Program Files\nodejs\node.exe" server.js
