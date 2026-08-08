@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

echo 🔍 Checking for Python...
where python >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
    echo ❌ Python is not installed or not in PATH.
    pause
    exit /b
)

IF NOT EXIST venv (
    echo 🛠️  Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate

@REM echo 📦 Installing/updating dependencies...
@REM pip install --upgrade pip >nul
@REM pip install -r requirements.txt

IF NOT EXIST config\.env (
    echo ❌ Hugging Face token file not found at config\.env
    echo Please add: HUGGINGFACE_TOKEN=your_token_here
    pause
    exit /b
)

:: Process all .wav and .mp3 files
echo 🔁 Searching for .wav and .mp3 files in audio\ ...

@REM for /R audio %%F in (*.wav *.mp3) do (
@REM     echo ▶️ Processing: %%~nxF
@REM     python diarize.py "%%F"
@REM )

for /R input_audio %%F in (*.wav *.mp3) do (
    echo ▶️ Processing: %%~nxF
    python diarize.py "%%F"
)

echo ✅ All files processed.
pause
