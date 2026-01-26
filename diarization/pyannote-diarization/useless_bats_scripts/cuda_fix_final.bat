@echo off
SETLOCAL
echo =========================================================
echo FINAL CUDA SUPPORT FIX FOR DIARIZATION
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
pip list | findstr torch
pip list | findstr numpy
echo.

echo Uninstalling incompatible packages...
pip uninstall -y torch torchvision torchaudio pyannote-audio numpy

echo.
echo Installing the right combination of packages...
echo.
echo 1. Installing NumPy 1.23.5 (compatible with numba)...
pip install numpy==1.23.5

echo.
echo 2. Installing PyTorch 1.13.1 with CUDA support...
pip install torch==1.13.1+cu117 torchvision==0.14.1+cu117 torchaudio==0.13.1+cu117 --index-url https://download.pytorch.org/whl/cu117

echo.
echo 3. Reinstalling pyannote-audio...
pip install pyannote-audio==2.1.1

echo.
echo 4. Checking other potential dependencies...
pip install -U librosa

echo.
echo Testing imports to verify compatibility:
python -c "import torch; import numpy; import pyannote.audio; from pyannote.audio import Pipeline; print(f'PyTorch: {torch.__version__} (CUDA: {torch.cuda.is_available()})'); print(f'NumPy: {numpy.__version__}'); print('All dependencies loaded successfully!')"

echo.
echo Testing PyAnnote pipeline import:
python -c "from pyannote.audio import Pipeline; print('Pipeline import successful')"

echo.
echo Installation complete! Press any key to close...
pause
ENDLOCAL 