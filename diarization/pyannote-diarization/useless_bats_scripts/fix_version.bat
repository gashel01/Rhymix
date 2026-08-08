@echo off
SETLOCAL
echo =========================================================
echo FIXING PYANNOTE VERSION FOR DIARIZATION
echo =========================================================
echo.

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Make sure we're using the venv
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo ERROR: Virtual environment not found!
    pause
    exit /b 1
)

echo.
echo Current package versions:
pip list | findstr pyannote

echo.
echo Installing compatible version of PyAnnote Audio...
pip uninstall -y pyannote.audio
pip install pyannote.audio==0.0.1

echo.
echo Version fixed! Press any key to exit...
pause
ENDLOCAL 