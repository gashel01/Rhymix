@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

echo Checking for Python...
where python >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH.
    exit /b 1
)

REM Get the directory where this batch file is located
SET script_dir=%~dp0

REM Initialize virtual environment if needed
IF NOT EXIST "%script_dir%\venv" (
    echo Creating virtual environment...
    python -m venv "%script_dir%\venv"
)

REM Activate the virtual environment
call "%script_dir%\venv\Scripts\activate"

REM Check for requirements
IF NOT EXIST "%script_dir%\requirements.txt" (
    echo ERROR: Requirements file not found
    exit /b 1
)

REM Check if packages are already installed
SET install_packages=true
IF EXIST "%script_dir%\venv\Lib\site-packages\pyannote" (
    SET install_packages=false
)

REM Install packages if needed
IF "%install_packages%"=="true" (
    echo Installing dependencies (this may take a few minutes)...
    pip install -r "%script_dir%\requirements.txt" >nul
    IF %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to install dependencies
        exit /b 1
    )
)

REM Check for .env file
IF NOT EXIST "%script_dir%\config\.env" (
    echo ERROR: Hugging Face token file not found at config\.env
    echo Please add: HUGGINGFACE_TOKEN=your_token_here
    exit /b 1
)

REM Process the audio file
SET input_file=%1
SET output_dir=%2

IF NOT EXIST "%input_file%" (
    echo ERROR: Input file not found: %input_file%
    exit /b 1
)

echo Processing: %input_file%
python "%script_dir%\simple_diarize.py" "%input_file%" "%output_dir%"
IF %ERRORLEVEL% NEQ 0 (
    echo ERROR: Diarization process failed
    exit /b 1
)

echo Successfully processed %input_file%
exit /b 0 