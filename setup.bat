@echo off
setlocal enabledelayedexpansion

REM ===========================================================================
REM Rhymix - First-time setup (Windows)
REM
REM Run this once after cloning. It will:
REM   1. Check prerequisites (Python 3.10, Node 18+, Git, CUDA)
REM   2. Create the main Python virtualenv and install dependencies
REM   3. Install PyTorch 2.4.1 with CUDA 12.1 support
REM   4. Clone the required AI model repos (skips any already present)
REM   5. Create a separate whisperX venv (required by the transcription pipeline)
REM   6. Install frontend (npm) dependencies
REM   7. Create .env from .env.example if one doesn't exist
REM
REM After this finishes, use run_all.bat to start the app.
REM Model weights (ACE-Step checkpoints, RVC pretrained models, etc.) must be
REM downloaded separately — see docs/SETUP_MODELS.md for instructions.
REM ===========================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "VENV=%ROOT%\venv"
set "WHISPERX_VENV=%ROOT%\whisperX"
set "FRONTEND=%ROOT%\frontend"
set "ERRORS=0"

echo.
echo ===========================================================================
echo   Rhymix - First-time setup
echo   Root: %ROOT%
echo ===========================================================================
echo.

REM ---------------------------------------------------------------------------
REM STEP 0 - Prerequisites check
REM ---------------------------------------------------------------------------
echo [STEP 0/6] Checking prerequisites...
echo.

REM Python 3.10
py -3.10 --version >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] Python 3.10 not found.
    echo          Install from: https://www.python.org/downloads/release/python-31011/
    echo          Make sure to tick "Add Python to PATH" during install.
    set "ERRORS=1"
) else (
    for /f "tokens=*" %%V in ('py -3.10 --version 2^>^&1') do echo   [OK]   %%V
)

REM Git
git --version >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] Git not found.
    echo          Install from: https://git-scm.com/download/win
    set "ERRORS=1"
) else (
    for /f "tokens=*" %%V in ('git --version 2^>^&1') do echo   [OK]   %%V
)

REM Node
node --version >nul 2>&1
if errorlevel 1 (
    echo   [FAIL] Node.js not found.
    echo          Install Node 18+ from: https://nodejs.org/en/download
    set "ERRORS=1"
) else (
    for /f "tokens=*" %%V in ('node --version 2^>^&1') do echo   [OK]   Node %%V
)

REM CUDA (non-fatal — warn only)
where nvcc >nul 2>&1
if errorlevel 1 (
    echo   [WARN] nvcc not found. A CUDA 12.1 compatible GPU is recommended.
    echo          CPU-only mode will still work but will be very slow.
) else (
    for /f "tokens=*" %%V in ('nvcc --version 2^>^&1 ^| findstr "release"') do echo   [OK]   CUDA %%V
)

if "%ERRORS%"=="1" (
    echo.
    echo   [ERROR] Prerequisites missing. Fix the issues above and re-run setup.bat.
    pause
    exit /b 1
)

echo.
echo   All required prerequisites found. Continuing...
echo.

REM ---------------------------------------------------------------------------
REM STEP 1 - Main Python virtualenv
REM ---------------------------------------------------------------------------
echo [STEP 1/6] Setting up main Python virtualenv...
echo.

if exist "%VENV%\Scripts\activate.bat" (
    echo   [SKIP] Virtualenv already exists at %VENV%
) else (
    echo   Creating venv with Python 3.10...
    py -3.10 -m venv "%VENV%"
    if errorlevel 1 (
        echo   [ERROR] Failed to create virtualenv.
        pause
        exit /b 1
    )
    echo   [OK]   Virtualenv created.
)

echo.
echo   Installing Python dependencies from requirements.txt...
call "%VENV%\Scripts\activate.bat"
python -m pip install --upgrade pip --quiet
pip install -r "%ROOT%\requirements.txt" --quiet
if errorlevel 1 (
    echo   [ERROR] pip install failed. Check requirements.txt and try again.
    pause
    exit /b 1
)
echo   [OK]   requirements.txt installed.

echo.
echo   Installing PyTorch 2.4.1 with CUDA 12.1...
pip install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121 --quiet
if errorlevel 1 (
    echo   [ERROR] PyTorch install failed.
    pause
    exit /b 1
)
echo   [OK]   PyTorch installed.
echo.

REM ---------------------------------------------------------------------------
REM STEP 2 - Clone AI model repos
REM ---------------------------------------------------------------------------
echo [STEP 2/6] Cloning AI model repos (skipping any already present)...
echo.

cd /d "%ROOT%"

call :clone_repo "ACE-Step-1.5"        "https://github.com/gael-gaussens/ACE-Step-1.5.git"
call :clone_repo "applio"              "https://github.com/IAHispano/Applio.git"
call :clone_repo "RC-stable-audio-tools" "https://github.com/RoyalCities/RC-stable-audio-tools.git"
call :clone_repo "SoulX-Singer"        "https://github.com/Soul-AILab/SoulX-Singer.git"
call :clone_repo "stage"               "https://github.com/giorgioskij/stage.git"

echo.

REM ---------------------------------------------------------------------------
REM STEP 3 - WhisperX venv (separate from main venv)
REM ---------------------------------------------------------------------------
echo [STEP 3/6] Setting up WhisperX venv...
echo.
echo   Rhymix runs WhisperX in a separate process to avoid dependency conflicts.
echo   This creates a dedicated venv at: %WHISPERX_VENV%
echo.

if exist "%WHISPERX_VENV%\Scripts\python.exe" (
    echo   [SKIP] WhisperX venv already exists.
) else (
    echo   Creating WhisperX venv...
    py -3.10 -m venv "%WHISPERX_VENV%"
    if errorlevel 1 (
        echo   [ERROR] Failed to create WhisperX venv.
        pause
        exit /b 1
    )

    echo   Installing whisperx and faster-whisper...
    "%WHISPERX_VENV%\Scripts\pip" install --upgrade pip --quiet
    "%WHISPERX_VENV%\Scripts\pip" install whisperx faster-whisper --quiet
    if errorlevel 1 (
        echo   [ERROR] whisperx install failed.
        pause
        exit /b 1
    )
    echo   [OK]   WhisperX venv ready.
)
echo.

REM ---------------------------------------------------------------------------
REM STEP 4 - Frontend
REM ---------------------------------------------------------------------------
echo [STEP 4/6] Installing frontend dependencies...
echo.

if exist "%FRONTEND%\node_modules" (
    echo   [SKIP] node_modules already exists.
) else (
    echo   Running npm install in frontend/...
    cd /d "%FRONTEND%"
    npm install --no-audit --no-fund
    if errorlevel 1 (
        echo   [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo   [OK]   Frontend dependencies installed.
    cd /d "%ROOT%"
)
echo.

REM ---------------------------------------------------------------------------
REM STEP 5 - Environment file
REM ---------------------------------------------------------------------------
echo [STEP 5/6] Setting up .env...
echo.

if exist "%ROOT%\.env" (
    echo   [SKIP] .env already exists. Leaving it untouched.
) else (
    copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
    echo   [OK]   Created .env from .env.example.
)

REM Inject WHISPERX_VENV into .env if it's not already there
findstr /C:"WHISPERX_VENV" "%ROOT%\.env" >nul 2>&1
if errorlevel 1 (
    echo. >> "%ROOT%\.env"
    echo # WhisperX dedicated venv (auto-set by setup.bat) >> "%ROOT%\.env"
    echo WHISPERX_VENV=%WHISPERX_VENV% >> "%ROOT%\.env"
    echo   [OK]   WHISPERX_VENV written to .env.
)
echo.

REM ---------------------------------------------------------------------------
REM STEP 6 - Model weights reminder
REM ---------------------------------------------------------------------------
echo [STEP 6/6] Model weights...
echo.
echo   The following model weights must be downloaded manually.
echo   Rhymix will still start without them but those features will fail:
echo.
echo   ACE-Step 1.5 checkpoints:
echo     -> See ACE-Step-1.5/README.md for download instructions.
echo     -> Place in: ACE-Step-1.5/checkpoints/
echo.
echo   RVC pretrained models:
echo     -> Download: https://huggingface.co/lj1995/VoiceConversionWebUI
echo     -> Place in: rvc/models/pretraineds/
echo.
echo   DDSP models (optional):
echo     -> Place in: models/ddsp/  (see docs/CONFIGURATION.md)
echo.

REM ---------------------------------------------------------------------------
REM Done
REM ---------------------------------------------------------------------------
echo ===========================================================================
echo   Setup complete! Next steps:
echo.
echo   1. Download model weights listed above (Step 6).
echo   2. Edit .env if you want to customize any settings.
echo   3. Run the app:   run_all.bat
echo ===========================================================================
echo.

pause
exit /b 0


REM ---------------------------------------------------------------------------
REM Helper: clone a repo if its directory doesn't already exist
REM   Usage: call :clone_repo "dirname" "https://..."
REM ---------------------------------------------------------------------------
:clone_repo
set "DIR=%ROOT%\%~1"
set "URL=%~2"

if exist "%DIR%\" (
    echo   [SKIP] %~1  already exists.
    exit /b 0
)

echo   Cloning %~1 from %URL%...
git clone --depth=1 "%URL%" "%DIR%"
if errorlevel 1 (
    echo   [WARN] Failed to clone %~1. You can clone it manually:
    echo          git clone %URL% %~1
)
exit /b 0
