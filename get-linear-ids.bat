@echo off
if "%~1"=="" (
    echo Usage: get-linear-ids.bat ^<LINEAR_API_KEY^>
    echo.
    echo Example: get-linear-ids.bat lin_api_xxxxxxxxxxxxx
    exit /b 1
)
node "%~dp0get-linear-ids.cjs" %1
