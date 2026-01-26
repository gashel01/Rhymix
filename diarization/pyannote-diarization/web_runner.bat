@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

REM Parameters:
REM %1 - Input audio file

echo ====================================================
echo Starting diarization process
echo Input file: %1
echo ====================================================

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Validate input parameters
IF "%~1"=="" (
    echo ERROR: Missing input audio file parameter
    exit /b 1
)

REM Check if input file exists
IF NOT EXIST "%~1" (
    echo ERROR: Input file does not exist: %1
    exit /b 1
)

REM Basic setup - like original run_diarization.bat
echo Setting up environment...
SET PATH=%PATH%;%script_dir%

REM Make sure we're using the venv from the original batch file
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo WARNING: Virtual environment not found, using system Python
)

REM Set up GPU environment variables - same as original
SET CUDA_VISIBLE_DEVICES=0
SET PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
SET PYTORCH_JIT=1
SET CUDA_LAUNCH_BLOCKING=0
SET TORCH_USE_RTLD_GLOBAL=1
SET OMP_NUM_THREADS=4

REM Process the audio file - use original diarize.py
echo Processing audio file: %1
python "%script_dir%\diarize.py" "%~1"

REM Check the return code and handle errors
IF %ERRORLEVEL% NEQ 0 (
    echo WARNING: Diarization script returned non-zero code %ERRORLEVEL%
    REM Continue anyway since we want to check for speaker directories
)

echo ====================================================
echo Diarization completed
echo ====================================================

exit /b 0 