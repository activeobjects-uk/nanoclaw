@echo off
cd /d "%~dp0"

:: Kill any previously running NanoClaw processes
powershell -NoProfile -Command ^
  "$procs = Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*nanoclaw*' };" ^
  "if ($procs) { $procs | ForEach-Object { Write-Host ('Stopping existing NanoClaw process (PID ' + $_.ProcessId + ')'); $_.Terminate() } }"

:: Start NanoClaw using the full path so it's identifiable via wmic
start /b node "%~dp0dist\index.js" >> logs\nanoclaw.log 2>> logs\nanoclaw.error.log
echo NanoClaw started. Logs: logs\nanoclaw.log
