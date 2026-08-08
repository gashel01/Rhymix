@echo off
SETLOCAL

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Make sure we're using the venv
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating diarization virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo WARNING: Diarization virtual environment not found!
    echo The test will run in the system Python environment,
    echo which may not be the same as your diarization environment.
)

REM Set up GPU environment variables
SET CUDA_VISIBLE_DEVICES=0
SET PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
SET PYTORCH_JIT=1
SET CUDA_LAUNCH_BLOCKING=0
SET TORCH_USE_RTLD_GLOBAL=1
SET OMP_NUM_THREADS=4

REM Run the CUDA test
echo Running CUDA support test...
python "%script_dir%\test_cuda.py"

echo.
echo Test complete. Press any key to close.
pause

ENDLOCAL 