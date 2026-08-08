@echo off
SETLOCAL

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Check if the service is already running
netstat -ano | find "9000" | find "LISTENING" > nul
IF %ERRORLEVEL% EQU 0 (
    echo Diarization model service is already running
    exit /b 0
)

REM Start the service if it's not running
echo Diarization model service is not running, starting it...

REM Start in a new window
start "" cmd /c "%script_dir%\start_enhanced_service.bat"

REM Wait for the service to initialize
echo Waiting for service to initialize...
timeout /t 10 /nobreak
echo Service should be running now
exit /b 0

ENDLOCAL 