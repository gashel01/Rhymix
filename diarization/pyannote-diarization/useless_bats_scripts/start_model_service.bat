@echo off
SETLOCAL

REM Get the directory of this batch file
SET script_dir=%~dp0

REM Make sure we're using the venv
IF EXIST "%script_dir%\venv\Scripts\activate.bat" (
    echo Activating virtual environment...
    call "%script_dir%\venv\Scripts\activate.bat"
) ELSE (
    echo WARNING: Virtual environment not found, using system Python
)

REM Set up GPU environment variables
SET CUDA_VISIBLE_DEVICES=0
SET PYTORCH_CUDA_ALLOC_CONF=max_split_size_mb:512

REM Start the model service
echo Starting diarization model service...
python "%script_dir%\model_service.py"

ENDLOCAL 