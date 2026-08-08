@echo off
SETLOCAL
echo =========================================================
echo STARTING ENHANCED DIARIZATION MODEL SERVICE
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

REM Set up GPU environment variables
SET CUDA_VISIBLE_DEVICES=0
SET PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
SET PYTORCH_JIT=1
SET CUDA_LAUNCH_BLOCKING=0
SET TORCH_USE_RTLD_GLOBAL=1
SET OMP_NUM_THREADS=4

REM Run the service
echo Starting enhanced model service...
python "%script_dir%\enhanced_model_service.py"

echo.
echo Service stopped. Press any key to exit...
pause
ENDLOCAL 