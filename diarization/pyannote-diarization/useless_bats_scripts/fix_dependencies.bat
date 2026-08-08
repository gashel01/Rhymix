@echo off
SETLOCAL
echo =========================================================
echo FIXING ALL DEPENDENCIES FOR DIARIZATION
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
pip list | findstr numpy
pip list | findstr torch
pip list | findstr pyannote
pip list | findstr numba
echo.

echo Uninstalling incompatible packages...
pip uninstall -y numpy torchaudio numba pyannote-audio

echo.
echo Installing compatible versions:
echo.
echo 1. Installing NumPy 1.23.5 (compatible with numba)...
pip install numpy==1.23.5

echo.
echo 2. Installing compatible torchaudio...
pip install torchaudio==0.13.1 --index-url https://download.pytorch.org/whl/cu118

echo.
echo 3. Reinstalling numba...
pip install numba==0.56.4

echo.
echo 4. Reinstalling pyannote-audio...
pip install pyannote-audio==2.1.1

echo.
echo Testing imports to verify compatibility:
python -c "import torch; import numpy; import numba; import pyannote.audio; print(f'PyTorch: {torch.__version__} (CUDA: {torch.cuda.is_available()})'); print(f'NumPy: {numpy.__version__}'); print('All dependencies loaded successfully!')"

echo.
echo Installation complete! Press any key to close...
pause
ENDLOCAL 