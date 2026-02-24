@echo off
REM start-nanoclaw.bat — Start NanoClaw on Windows
REM To stop: close this window or press Ctrl+C

cd /d "C:\Projects\nanoclaw"

echo Starting NanoClaw...
node dist\index.js
