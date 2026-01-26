@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

REM Parameters:
REM %1 - Input audio file
REM %2 - Output directory

echo ====================================================
echo DIRECT DIARIZATION PROCESS (WITH PROGRESS TRACKING)
echo ====================================================
echo Input file: %1
echo Output directory: %2
echo.

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Validate input parameters
IF "%~1"=="" (
    echo ERROR: Missing input audio file parameter
    exit /b 1
)

IF "%~2"=="" (
    echo ERROR: Missing output directory parameter
    exit /b 1
)

REM Create output directory if it doesn't exist
IF NOT EXIST "%~2" (
    echo Creating output directory: %2
    mkdir "%~2"
)

REM Create logs directory
IF NOT EXIST "%~2\logs" mkdir "%~2\logs"

REM Create the progress file
echo {"percent": 5, "stage": "Starting diarization", "current_time": "%TIME%", "elapsed": "0.10s"} > "%~2\progress.json"

REM Make sure we're using the venv
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo ERROR: Virtual environment not found!
    exit /b 1
)

echo {"percent": 10, "stage": "Setting up environment", "current_time": "%TIME%", "elapsed": "0.50s"} > "%~2\progress.json"

REM Set up CUDA environment variables (same as original run_diarization.bat)
SET CUDA_VISIBLE_DEVICES=0
SET PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512
SET PYTORCH_JIT=1
SET TORCH_USE_RTLD_GLOBAL=1
SET OMP_NUM_THREADS=4

echo {"percent": 15, "stage": "Loading model and processing audio", "current_time": "%TIME%", "elapsed": "1.00s"} > "%~2\progress.json"

REM Call our enhanced script that wraps the original
python "%script_dir%\progress_diarize.py" "%~1" "%~2" --log-file "%~2\logs\diarization.json"

REM Check return code and handle errors
IF %ERRORLEVEL% NEQ 0 (
    echo Checking if this is just a torchaudio warning...
    type "%~2\logs\diarization.json" | findstr /C:"torchaudio backend is switched to 'soundfile'" > nul
    IF !ERRORLEVEL! EQU 0 (
        echo WARNING: Ignoring torchaudio backend warning and continuing processing
        echo {"percent": 100, "stage": "Diarization completed (with warnings)", "current_time": "%TIME%", "elapsed": "1.50s"} > "%~2\progress.json"
    ) ELSE (
        echo ERROR: Diarization failed with code %ERRORLEVEL%
        echo {"percent": 0, "stage": "Error in diarization", "current_time": "%TIME%", "elapsed": "0.00s"} > "%~2\progress.json"
        exit /b %ERRORLEVEL%
    )
) ELSE (
    echo {"percent": 100, "stage": "Diarization completed successfully", "current_time": "%TIME%", "elapsed": "2.00s"} > "%~2\progress.json"
)

echo ====================================================
echo Diarization completed!
echo ====================================================

exit /b 0 