@echo off
SETLOCAL
echo =========================================================
echo REBUILDING DIARIZATION ENVIRONMENT
echo =========================================================
echo.

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Check for requirements file
IF NOT EXIST "%script_dir%\requirements.txt" (
    echo ERROR: requirements.txt not found!
    pause
    exit /b 1
)

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
echo Backing up current requirements...
pip freeze > "%script_dir%\requirements_backup.txt"
echo Saved to requirements_backup.txt

echo.
echo Installing base packages with CUDA support...
pip install torch==2.0.1+cu118 torchaudio==2.0.2+cu118 --index-url https://download.pytorch.org/whl/cu118
pip install numpy==1.23.5

echo.
echo Installing requirements...
pip install -r "%script_dir%\requirements.txt"

echo.
echo Testing imports to verify compatibility:
python -c "import torch; import numpy; try: import pyannote.audio; print('PyAnnote-Audio imported successfully'); except ImportError as e: print(f'Error importing PyAnnote-Audio: {e}'); print(f'PyTorch: {torch.__version__} (CUDA: {torch.cuda.is_available()})'); print(f'NumPy: {numpy.__version__}')"

echo.
echo Installation complete! Press any key to close...
pause
ENDLOCAL 