@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

:: Create folders
mkdir pyannote-diarization
cd pyannote-diarization
mkdir audio
mkdir output
mkdir config

:: Create requirements.txt
echo pyannote-audio==2.1.1> requirements.txt
echo torch>=1.10>> requirements.txt
echo torchaudio>> requirements.txt
echo python-dotenv>> requirements.txt

:: Create diarize.py
(
echo import os
echo from dotenv import load_dotenv
echo from pyannote.audio import Pipeline
echo import sys
echo.
echo load_dotenv("config/.env")
echo.
echo HUGGINGFACE_TOKEN = os.getenv("HUGGINGFACE_TOKEN")
echo if not HUGGINGFACE_TOKEN:
echo ^    print("❌ Missing Hugging Face token. Please create a .env file in config/ with your token:\\nHUGGINGFACE_TOKEN=your_token_here")
echo ^    sys.exit(1)
echo.
echo AUDIO_FILE = "audio/your_audio.wav"
echo if not os.path.exists(AUDIO_FILE):
echo ^    print(f"❌ Audio file not found: {AUDIO_FILE}")
echo ^    sys.exit(1)
echo.
echo pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization", use_auth_token=HUGGINGFACE_TOKEN)
echo diarization = pipeline(AUDIO_FILE)
echo.
echo with open("output/diarization.txt", "w") as f:
echo ^    for turn, _, speaker in diarization.itertracks(yield_label=True):
echo ^        f.write(f"[{turn.start:.2f} - {turn.end:.2f}] {speaker}\\n")
echo.
echo print("✅ Diarization complete. Check output/diarization.txt")
) > diarize.py

:: Create .env file
(
echo HUGGINGFACE_TOKEN=
) > config\.env

:: Create run_diarization.bat
(
echo @echo off
echo SETLOCAL
echo.
echo :: Check if Python is installed
echo where python ^>nul 2^>nul
echo IF %%ERRORLEVEL%% NEQ 0 (
echo ^    echo ❌ Python is not installed. Please install Python 3.10 or newer.
echo ^    pause
echo ^    exit /b
echo )
echo.
echo :: Set up virtual environment
echo IF NOT EXIST venv (
echo ^    echo Creating virtual environment...
echo ^    python -m venv venv
echo )
echo.
echo :: Activate venv and install requirements
echo call venv\Scripts\activate
echo echo Installing requirements...
echo pip install --upgrade pip ^>nul
echo pip install -r requirements.txt
echo.
echo :: Check for audio file
echo IF NOT EXIST audio\your_audio.wav (
echo ^    echo ❌ Please add a file named 'your_audio.wav' in the 'audio' folder.
echo ^    pause
echo ^    exit /b
echo )
echo.
echo :: Run the diarization script
echo python diarize.py
echo pause
) > run_diarization.bat

echo ✅ Setup complete. Now add your Hugging Face token to config\.env and your audio file to audio\your_audio.wav
pause
