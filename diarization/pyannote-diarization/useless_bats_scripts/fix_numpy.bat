@echo off
SETLOCAL
echo =========================================================
echo FIXING NUMPY COMPATIBILITY ISSUES
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
echo Current NumPy installation:
pip list | findstr numpy
echo.

echo Uninstalling current NumPy (2.x version)...
pip uninstall -y numpy

echo.
echo Installing NumPy 1.24.4 (compatible with PyTorch)...
pip install numpy==1.24.4

echo.
echo Verifying PyTorch CUDA installation...
python -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}')"

echo.
echo Installation complete! Press any key to close...
pause
ENDLOCAL 