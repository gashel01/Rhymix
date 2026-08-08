@echo off
echo Starting Diarization Model Service
echo ====================================
echo This window will display the model service logs.
echo DO NOT CLOSE THIS WINDOW while using diarization.
echo.
echo Press Ctrl+C to stop the service when finished.
echo.

cd /d "%~dp0"
call start_model_service.bat

pause 