@echo off
SETLOCAL
echo =========================================================
echo FIXING CUDA SUPPORT FOR DIARIZATION VIRTUAL ENVIRONMENT
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
    echo Cannot fix CUDA support without the virtual environment.
    pause
    exit /b 1
)

echo.
echo Current PyTorch installation:
pip list | findstr torch
echo.

echo Uninstalling current PyTorch (CPU version)...
pip uninstall -y torch torchvision torchaudio

echo.
echo Installing PyTorch with CUDA 11.8 support...
pip install torch==2.1.0+cu118 torchvision==0.16.0+cu118 torchaudio==2.1.0 --index-url https://download.pytorch.org/whl/cu118

echo.
echo Updating torch dependencies...
pip install -U numpy

echo.
echo Testing CUDA support after installation:
python "%script_dir%\test_cuda.py"

echo.
echo Installation complete! Press any key to close...
pause
ENDLOCAL 