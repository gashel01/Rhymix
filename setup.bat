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
REM downloaded separately - see docs/SETUP_MODELS.md for instructions.
REM ===========================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "VENV=%ROOT%\venv"
set "WHISPERX_VENV=%ROOT%\whisperX"
set "FRONTEND=%ROOT%\frontend"
set "LOG=%ROOT%\setup.log"

REM Step result tracking (0=pass 1=fail 2=skip)
set "R_PREREQ=0"
set "R_VENV=0"
set "R_TORCH=0"
set "R_REPOS=0"
set "R_WHISPERX=0"
set "R_FRONTEND=0"
set "R_ENV=0"

REM Total steps for progress bar
set "TOTAL=7"

REM Initialize log file (type nul truncates to 0 bytes reliably even on shared drives)
type nul > "%LOG%"
call :log "=============================================================="
call :log "  Rhymix setup started at %DATE% %TIME%"
call :log "  Root: %ROOT%"
call :log "=============================================================="

echo.
echo ===========================================================================
echo   Rhymix - First-time setup
echo   Log: %LOG%
echo ===========================================================================
echo.

REM ---------------------------------------------------------------------------
REM STEP 1/7 - Prerequisites
REM ---------------------------------------------------------------------------
call :bar 0
call :header 1 "Checking prerequisites"

set "PREREQ_FAIL=0"

REM Python 3.10
py -3.10 --version >nul 2>&1
if errorlevel 1 (
    call :fail "Python 3.10 not found."
    call :info  "  Install from: https://www.python.org/downloads/release/python-31011/"
    call :info  "  Tick 'Add Python to PATH' during install."
    set "PREREQ_FAIL=1"
) else (
    for /f "tokens=*" %%V in ('py -3.10 --version 2^>^&1') do call :ok "%%V"
)

REM Git
git --version >nul 2>&1
if errorlevel 1 (
    call :fail "Git not found."
    call :info  "  Install from: https://git-scm.com/download/win"
    set "PREREQ_FAIL=1"
) else (
    for /f "tokens=*" %%V in ('git --version 2^>^&1') do call :ok "%%V"
)

REM Node.js
node --version >nul 2>&1
if errorlevel 1 (
    call :fail "Node.js not found."
    call :info  "  Install Node 18+ from: https://nodejs.org/en/download"
    set "PREREQ_FAIL=1"
) else (
    for /f "tokens=*" %%V in ('node --version 2^>^&1') do call :ok "Node %%V"
)

REM CUDA (non-fatal)
where nvcc >nul 2>&1
if errorlevel 1 (
    call :warn "nvcc not found - GPU recommended (CPU-only will be slow)"
) else (
    for /f "tokens=*" %%V in ('nvcc --version 2^>^&1 ^| findstr "release"') do call :ok "CUDA %%V"
)

if "%PREREQ_FAIL%"=="1" (
    call :fail "Prerequisites missing. Fix above issues and re-run setup.bat."
    set "R_PREREQ=1"
    call :summary
    pause
    exit /b 1
)
call :step_done 1 "R_PREREQ"

REM ---------------------------------------------------------------------------
REM STEP 2/7 - Main Python venv
REM ---------------------------------------------------------------------------
call :bar 1
call :header 2 "Setting up main Python virtualenv"

if exist "%VENV%\Scripts\activate.bat" (
    call :skip "Virtualenv already exists at %VENV%"
    set "R_VENV=2"
) else (
    call :info "Creating venv with Python 3.10..."
    py -3.10 -m venv "%VENV%" >> "%LOG%" 2>&1
    if errorlevel 1 (
        call :fail "Failed to create virtualenv. See setup.log for details."
        set "R_VENV=1"
        call :summary
        pause
        exit /b 1
    )
    call :ok "Virtualenv created at %VENV%"
)

REM Use explicit venv paths for all pip/python calls - more reliable than activation in batch
set "VPIP=%VENV%\Scripts\pip.exe"
set "VPYTHON=%VENV%\Scripts\python.exe"

call :info "Upgrading pip..."
"%VPYTHON%" -m pip install --upgrade pip >> "%LOG%" 2>&1
if errorlevel 1 ( call :warn "pip upgrade failed (non-fatal)" )

call :info "Installing requirements.txt (this may take a few minutes)..."
"%VPIP%" install -r "%ROOT%\requirements.txt" > "%ROOT%\setup_tmp.txt" 2>&1
set "PIP_RC=!ERRORLEVEL!"
type "%ROOT%\setup_tmp.txt"
type "%ROOT%\setup_tmp.txt" >> "%LOG%"
del "%ROOT%\setup_tmp.txt" >nul 2>&1
if "!PIP_RC!" neq "0" (
    call :fail "pip install -r requirements.txt failed. See setup.log for details."
    set "R_VENV=1"
    call :summary
    pause
    exit /b 1
)
call :ok "requirements.txt installed."
call :step_done 2 "R_VENV"

REM ---------------------------------------------------------------------------
REM STEP 3/7 - PyTorch (CUDA 12.1 required - GPU build)
REM ---------------------------------------------------------------------------
call :bar 2
call :header 3 "Installing PyTorch 2.4.1 + CUDA 12.1"

REM Skip if torch is already importable in the venv
"%VPYTHON%" -c "import torch; print(torch.__version__)" > "%ROOT%\setup_tmp.txt" 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%V in ('type "%ROOT%\setup_tmp.txt"') do call :skip "torch %%V already installed in venv - skipping."
    del "%ROOT%\setup_tmp.txt" >nul 2>&1
    call :step_done 3 "R_TORCH"
    goto :after_torch
)
del "%ROOT%\setup_tmp.txt" >nul 2>&1

call :info "Downloading wheels (1-3 GB - may take a few minutes)..."
call :info "Index: https://download.pytorch.org/whl/cu121"
"%VPIP%" install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121 > "%ROOT%\setup_tmp.txt" 2>&1
set "PIP_RC=!ERRORLEVEL!"
type "%ROOT%\setup_tmp.txt"
type "%ROOT%\setup_tmp.txt" >> "%LOG%"
del "%ROOT%\setup_tmp.txt" >nul 2>&1
if "!PIP_RC!"=="0" (
    call :ok "PyTorch 2.4.1 + CUDA 12.1 installed."
    call :step_done 3 "R_TORCH"
) else (
    call :fail "PyTorch install failed. See setup.log for details."
    call :info "  Make sure CUDA 12.1 drivers are installed and download.pytorch.org is reachable."
    call :info "  To retry manually (with venv active):"
    call :info "    %VPIP% install torch==2.4.1 torchvision==0.19.1 torchaudio==2.4.1 --index-url https://download.pytorch.org/whl/cu121"
    call :warn "Continuing setup - re-run setup.bat to retry PyTorch."
    set "R_TORCH=1"
)

:after_torch

REM ---------------------------------------------------------------------------
REM STEP 4/7 - AI model repos
REM ---------------------------------------------------------------------------
call :bar 3
call :header 4 "Cloning AI model repos"

cd /d "%ROOT%"
set "CLONE_FAILS=0"

call :clone_repo "ACE-Step-1.5"          "https://github.com/gael-gaussens/ACE-Step-1.5.git"
call :clone_repo "applio"                "https://github.com/IAHispano/Applio.git"
call :clone_repo "RC-stable-audio-tools" "https://github.com/RoyalCities/RC-stable-audio-tools.git"
call :clone_repo "SoulX-Singer"          "https://github.com/Soul-AILab/SoulX-Singer.git"
call :clone_repo "stage"                 "https://github.com/giorgioskij/stage.git"

REM Patch applio/core.py: fix tts_voices.json path and make load non-fatal.
REM The upstream file uses a CWD-relative path that breaks when run from ROOT.
call :info "Applying applio compatibility patch..."
"%VPYTHON%" "%ROOT%\scripts\patch_applio.py" >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "applio patch failed - FastAPI may not start. Check setup.log."
) else (
    call :ok "applio patch applied."
)

if "%CLONE_FAILS%"=="0" (
    call :step_done 4 "R_REPOS"
) else (
    call :warn "Some repos failed to clone (see above). You can clone them manually."
    set "R_REPOS=1"
)

REM ---------------------------------------------------------------------------
REM STEP 5/7 - WhisperX venv
REM ---------------------------------------------------------------------------
call :bar 4
call :header 5 "Setting up WhisperX venv"
call :info "WhisperX runs in a separate venv to avoid dependency conflicts."
call :info "Location: %WHISPERX_VENV%"

if exist "%WHISPERX_VENV%\Scripts\python.exe" (
    call :skip "WhisperX venv already exists."
    set "R_WHISPERX=2"
) else (
    call :info "Creating WhisperX venv with Python 3.10..."
    py -3.10 -m venv "%WHISPERX_VENV%" >> "%LOG%" 2>&1
    if errorlevel 1 (
        call :fail "Failed to create WhisperX venv. See setup.log."
        set "R_WHISPERX=1"
    ) else (
        call :info "Upgrading pip in WhisperX venv..."
        "%WHISPERX_VENV%\Scripts\pip" install --upgrade pip >> "%LOG%" 2>&1

        call :info "Installing whisperx and faster-whisper (may take a few minutes)..."
        "%WHISPERX_VENV%\Scripts\pip" install whisperx faster-whisper > "%ROOT%\setup_tmp.txt" 2>&1
        set "PIP_RC=!ERRORLEVEL!"
        type "%ROOT%\setup_tmp.txt"
        type "%ROOT%\setup_tmp.txt" >> "%LOG%"
        del "%ROOT%\setup_tmp.txt" >nul 2>&1
        if "!PIP_RC!" neq "0" (
            call :fail "whisperx install failed. See setup.log."
            set "R_WHISPERX=1"
        ) else (
            call :ok "WhisperX venv ready."
            call :step_done 5 "R_WHISPERX"
        )
    )
)

REM ---------------------------------------------------------------------------
REM STEP 6/7 - Frontend
REM ---------------------------------------------------------------------------
call :bar 5
call :header 6 "Installing frontend dependencies"

if exist "%FRONTEND%\node_modules" (
    call :skip "node_modules already exists."
    set "R_FRONTEND=2"
) else (
    call :info "Running npm install in frontend/ (may take a few minutes)..."
    cd /d "%FRONTEND%"
    npm install --no-audit --no-fund > "%ROOT%\setup_tmp.txt" 2>&1
    set "NPM_RC=!ERRORLEVEL!"
    type "%ROOT%\setup_tmp.txt"
    type "%ROOT%\setup_tmp.txt" >> "%LOG%"
    del "%ROOT%\setup_tmp.txt" >nul 2>&1
    if "!NPM_RC!" neq "0" (
        call :fail "npm install failed. See setup.log for details."
        set "R_FRONTEND=1"
    ) else (
        call :ok "Frontend dependencies installed."
        call :step_done 6 "R_FRONTEND"
    )
    cd /d "%ROOT%"
)

REM ---------------------------------------------------------------------------
REM STEP 7/7 - .env file
REM ---------------------------------------------------------------------------
call :bar 6
call :header 7 "Setting up .env"

if exist "%ROOT%\.env" (
    call :skip ".env already exists - leaving it untouched."
    set "R_ENV=2"
) else (
    copy "%ROOT%\.env.example" "%ROOT%\.env" >nul
    if errorlevel 1 (
        call :fail "Could not copy .env.example to .env."
        set "R_ENV=1"
    ) else (
        call :ok "Created .env from .env.example."
        call :step_done 7 "R_ENV"
    )
)

REM Inject WHISPERX_VENV path if not already present
findstr /C:"WHISPERX_VENV" "%ROOT%\.env" >nul 2>&1
if errorlevel 1 (
    echo. >> "%ROOT%\.env"
    echo # WhisperX dedicated venv (auto-set by setup.bat) >> "%ROOT%\.env"
    echo WHISPERX_VENV=%WHISPERX_VENV% >> "%ROOT%\.env"
    call :ok "WHISPERX_VENV path written to .env."
)

REM ---------------------------------------------------------------------------
REM Final bar + model weights reminder
REM ---------------------------------------------------------------------------
call :bar 7

echo.
echo   ---------------------------------------------------------------------------
echo   Model weights must be downloaded separately (Rhymix starts without them
echo   but those features will fail):
echo.
echo     ACE-Step 1.5  -^> See ACE-Step-1.5/README.md for download instructions.
echo                      Place in: ACE-Step-1.5/checkpoints/
echo.
echo     RVC pretraineds -^> https://huggingface.co/lj1995/VoiceConversionWebUI
echo                         Place in: rvc/models/pretraineds/
echo.
echo     DDSP models (optional) -^> models/ddsp/
echo   ---------------------------------------------------------------------------

REM ---------------------------------------------------------------------------
REM Summary
REM ---------------------------------------------------------------------------
call :summary

pause
exit /b 0


REM ===========================================================================
REM  S U B R O U T I N E S
REM ===========================================================================

REM ---------------------------------------------------------------------------
REM :bar  step_completed  (0-7)
REM   Prints a 40-char ASCII progress bar.
REM   step 0 = just starting (empty bar), step 7 = full bar.
REM ---------------------------------------------------------------------------
:bar
set /a "DONE_STEPS=%~1"
set /a "FILLED=(DONE_STEPS * 40) / TOTAL"
set /a "EMPTY=40 - FILLED"
set /a "PCT=(DONE_STEPS * 100) / TOTAL"

set "BAR_STR="
for /l %%i in (1,1,%FILLED%) do set "BAR_STR=!BAR_STR!="
if %FILLED% lss 40 set "BAR_STR=!BAR_STR!>"
for /l %%i in (1,1,%EMPTY%) do set "BAR_STR=!BAR_STR! "

echo.
echo   [!BAR_STR!] %PCT%%%  (%DONE_STEPS%/%TOTAL%)
echo.
call :log "--- Progress %PCT%%% (%DONE_STEPS%/%TOTAL%) ---"
exit /b 0


REM ---------------------------------------------------------------------------
REM :header  step  description
REM ---------------------------------------------------------------------------
:header
set "_STEP=%~1"
set "_DESC=%~2"
echo   -----------------------------------------------------------------------
echo   STEP %_STEP%/%TOTAL%  %_DESC%
echo   -----------------------------------------------------------------------
call :log ""
call :log "STEP %_STEP%/%TOTAL%  %_DESC%  [%TIME%]"
exit /b 0


REM ---------------------------------------------------------------------------
REM :step_done  step  result_var
REM   Marks a result variable as 0 (pass) if not already 1 (fail) or 2 (skip)
REM ---------------------------------------------------------------------------
:step_done
set "_VAR=%~2"
if "!%_VAR%!"=="0" (
    set "%_VAR%=0"
)
exit /b 0


REM ---------------------------------------------------------------------------
REM :ok / :fail / :warn / :skip / :info   message
REM ---------------------------------------------------------------------------
:ok
echo   [OK]   %~1
call :log "[OK]   %~1"
exit /b 0

:fail
echo   [FAIL] %~1
call :log "[FAIL] %~1"
exit /b 0

:warn
echo   [WARN] %~1
call :log "[WARN] %~1"
exit /b 0

:skip
echo   [SKIP] %~1
call :log "[SKIP] %~1"
exit /b 0

:info
echo   ...    %~1
call :log "...    %~1"
exit /b 0


REM ---------------------------------------------------------------------------
REM :log  message
REM   Appends message to setup.log with a timestamp prefix.
REM ---------------------------------------------------------------------------
:log
echo [%TIME%] %~1 >> "%LOG%" 2>nul
exit /b 0


REM ---------------------------------------------------------------------------
REM :clone_repo  dirname  url
REM   Clones a repo if its directory doesn't already exist.
REM   Sets CLONE_FAILS=1 on failure.
REM ---------------------------------------------------------------------------
:clone_repo
set "_DIR=%ROOT%\%~1"
set "_URL=%~2"

if exist "%_DIR%\" (
    call :skip "%~1  (already exists)"
    exit /b 0
)

call :info "Cloning %~1 ..."
git clone --depth=1 "%_URL%" "%_DIR%" >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "Failed to clone %~1"
    call :info "  Manual fix: git clone %_URL% %~1"
    set "CLONE_FAILS=1"
) else (
    call :ok "Cloned %~1"
)
exit /b 0


REM ---------------------------------------------------------------------------
REM :summary
REM   Prints a result table at the end showing pass/fail/skip per step.
REM ---------------------------------------------------------------------------
:summary
echo.
echo ===========================================================================
echo   SETUP SUMMARY                                   %DATE% %TIME%
echo ===========================================================================
call :summary_row "1. Prerequisites   " "%R_PREREQ%"
call :summary_row "2. Python venv     " "%R_VENV%"
call :summary_row "3. PyTorch CUDA    " "%R_TORCH%"
call :summary_row "4. AI repos        " "%R_REPOS%"
call :summary_row "5. WhisperX venv   " "%R_WHISPERX%"
call :summary_row "6. Frontend (npm)  " "%R_FRONTEND%"
call :summary_row "7. .env file       " "%R_ENV%"
echo ===========================================================================

set "ANY_FAIL=0"
for %%S in (%R_PREREQ% %R_VENV% %R_TORCH% %R_REPOS% %R_WHISPERX% %R_FRONTEND% %R_ENV%) do (
    if "%%S"=="1" set "ANY_FAIL=1"
)

if "%ANY_FAIL%"=="0" (
    echo.
    echo   All steps completed successfully!
    echo   Next steps:
    echo     1. Download model weights - see Step 4 output above and docs/SETUP_MODELS.md
    echo     2. Edit .env if you want to customize settings
    echo     3. Start the app:  run_all.bat
) else (
    echo.
    echo   One or more steps failed. Review the output above and setup.log:
    echo     %LOG%
    echo   Fix the errors and re-run setup.bat (completed steps will be skipped).
)

echo ===========================================================================
echo.
call :log ""
call :log "=== SUMMARY ==="
call :log "R_PREREQ=%R_PREREQ%  R_VENV=%R_VENV%  R_TORCH=%R_TORCH%  R_REPOS=%R_REPOS%"
call :log "R_WHISPERX=%R_WHISPERX%  R_FRONTEND=%R_FRONTEND%  R_ENV=%R_ENV%"
exit /b 0


REM ---------------------------------------------------------------------------
REM :summary_row  label  result_code
REM   0=PASSED  1=FAILED  2=SKIPPED
REM ---------------------------------------------------------------------------
:summary_row
set "_LABEL=%~1"
set "_CODE=%~2"
if "%_CODE%"=="0" echo     %_LABEL%  PASSED
if "%_CODE%"=="1" echo     %_LABEL%  FAILED  ^<--- see setup.log
if "%_CODE%"=="2" echo     %_LABEL%  skipped (already done)
exit /b 0
