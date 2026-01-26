@echo off
SETLOCAL
echo =========================================================
echo FIXING PYANNOTE-AUDIO VERSION COMPATIBILITY
echo =========================================================
echo.

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Make sure we're using the venv
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating diarization virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo ERROR: Diarization virtual environment not found!
    pause
    exit /b 1
)

echo.
echo Current package versions:
pip list | findstr pyannote
echo.

echo Uninstalling current PyAnnote...
pip uninstall -y pyannote.audio

echo.
echo Redownloading correct PyAnnote Model...
python -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='pyannote/speaker-diarization', force_download=True)"

echo.
echo Installing compatible version of PyAnnote Audio...
pip install pyannote.audio==0.0.1

echo.
echo Fix complete! Press any key to close...
pause
ENDLOCAL 