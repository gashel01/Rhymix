@echo off
SETLOCAL
echo =========================================================
echo DOWNLOADING PYANNOTE DIARIZATION MODEL
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

REM Check for HF_TOKEN in environment
IF "%HUGGINGFACE_TOKEN%"=="" (
    REM Try to load from .env file
    IF EXIST "%script_dir%\config\.env" (
        echo Loading token from .env file...
        for /f "tokens=1,* delims==" %%a in ('type "%script_dir%\config\.env" ^| findstr "HUGGINGFACE_TOKEN"') do (
            set HUGGINGFACE_TOKEN=%%b
        )
    )
)

REM Check token again
IF "%HUGGINGFACE_TOKEN%"=="" (
    echo ERROR: No Hugging Face token found!
    echo Please ensure your token is in the config/.env file
    pause
    exit /b 1
)

echo.
echo Step 1: Uninstalling current PyAnnote...
pip uninstall -y pyannote.audio

echo.
echo Step 2: Installing compatible version of PyAnnote Audio...
pip install pyannote.audio==0.0.1

echo.
echo Step 3: Setting up Hugging Face token...
python -c "from huggingface_hub import HfApi; api = HfApi(); api.set_access_token('%HUGGINGFACE_TOKEN%')"

echo.
echo Step 4: Downloading models directly...
echo This may take a few minutes...
python -c "from pyannote.audio.pipelines import VoiceActivityDetection; from pyannote.audio import Pipeline; print('Downloading VAD model...'); vad = VoiceActivityDetection.from_pretrained('pyannote/voice-activity-detection', use_auth_token='%HUGGINGFACE_TOKEN%'); print('Downloading diarization model...'); pipeline = Pipeline.from_pretrained('pyannote/speaker-diarization', use_auth_token='%HUGGINGFACE_TOKEN%'); print('Models downloaded successfully!')"

echo.
echo Testing model access...
python -c "from pyannote.audio import Pipeline; pipeline = Pipeline.from_pretrained('pyannote/speaker-diarization', use_auth_token='%HUGGINGFACE_TOKEN%'); print('Model loaded successfully!')"

echo.
echo Download process complete! Press any key to close...
pause
ENDLOCAL 