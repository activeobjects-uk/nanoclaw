@echo off

:: Stop NanoClaw node process
powershell -NoProfile -Command ^
  "$procs = Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*nanoclaw*' };" ^
  "if ($procs) { $procs | ForEach-Object { Write-Host ('Stopping NanoClaw process (PID ' + $_.ProcessId + ')'); $_.Terminate() }; Write-Host 'Done.' }" ^
  "else { Write-Host 'No NanoClaw processes found.' }"

:: Stop any running agent containers
echo Stopping agent containers...
for /f "tokens=*" %%c in ('docker ps --filter name^=nanoclaw- -q 2^>nul') do (
    echo Stopping container %%c...
    docker stop %%c >nul 2>&1
)
echo All done.
