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
REM   5. Create the WanGP venv that hosts YuE2, the song generator (Python 3.11)
REM   6. Install frontend (npm) dependencies
REM   7. Create .env from .env.example if one doesn't exist
REM
REM After this finishes, use run_all.bat to start the app.
REM Model weights (YuE2 checkpoints, RVC pretrained models, etc.) must be
REM downloaded separately - see docs/SETUP_MODELS.md for instructions.
REM ===========================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "VENV=%ROOT%\venv"
set "FRONTEND=%ROOT%\frontend"
set "LOG=%ROOT%\setup.log"

REM Step result tracking (0=pass 1=fail 2=skip)
set "R_PREREQ=0"
set "R_VENV=0"
set "R_TORCH=0"
set "R_REPOS=0"
set "R_WANGP=0"
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

REM Write a .pth file so applio/ and project root are on sys.path automatically.
REM This is the only reliable way to make 'from core import ...' and
REM 'from rvc.lib import ...' work regardless of CWD or how Python is launched.
set "PTH_FILE=%VENV%\Lib\site-packages\rhymix.pth"
(echo %ROOT%
 echo %ROOT%\applio) > "%PTH_FILE%"
call :ok "Written sys.path config to venv\Lib\site-packages\rhymix.pth"

REM ---------------------------------------------------------------------------
REM  Hash requirements.txt to skip pip when nothing has changed.
REM  After a successful install the MD5 is written to venv\.pip-hash.
REM  On the next run: if the hash matches, pip is skipped entirely (fast path).
REM  If requirements.txt changed or the hash file is absent, pip re-runs.
REM ---------------------------------------------------------------------------
set "PIP_HASH_FILE=%VENV%\.pip-hash"
set "CURR_HASH="
"%VPYTHON%" -c "import hashlib,pathlib; print(hashlib.md5(pathlib.Path(r'%ROOT%\requirements.txt').read_bytes()).hexdigest())" > "%ROOT%\setup_tmp.txt" 2>&1
set /p CURR_HASH=<"%ROOT%\setup_tmp.txt"
del "%ROOT%\setup_tmp.txt" >nul 2>&1

REM Read stored hash outside any block - set /p with < redirect is unreliable inside ( ).
set "STORED_HASH="
if exist "%PIP_HASH_FILE%" set /p STORED_HASH=<"%PIP_HASH_FILE%"

set "NEED_PIP=1"
if not "!CURR_HASH!"=="" if "!CURR_HASH!"=="!STORED_HASH!" set "NEED_PIP=0"

if "!NEED_PIP!"=="1" (
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
    echo !CURR_HASH!>"%PIP_HASH_FILE%"
    call :ok "requirements.txt installed."
    set "R_VENV=0"
) else (
    call :skip "requirements.txt unchanged - pip install skipped."
    set "R_VENV=2"
)

REM ---------------------------------------------------------------------------
REM STEP 3/7 - PyTorch (CUDA 12.1 required - GPU build)
REM ---------------------------------------------------------------------------
call :bar 2
call :header 3 "Installing PyTorch 2.4.1 + CUDA 12.1"

REM Skip only if torch is already installed AND is a CUDA build (not +cpu).
REM A CPU-only torch (e.g. 2.11.0+cpu) must be replaced with the CUDA wheel.
"%VPYTHON%" -c "import torch, sys; v=torch.__version__; is_cuda='cu' in v; print(v); sys.exit(0 if is_cuda else 1)" > "%ROOT%\setup_tmp.txt" 2>&1
if not errorlevel 1 (
    for /f "tokens=*" %%V in ('type "%ROOT%\setup_tmp.txt"') do call :skip "torch %%V (CUDA^) already installed - skipping."
    del "%ROOT%\setup_tmp.txt" >nul 2>&1
    call :step_done 3 "R_TORCH"
    goto :after_torch
)
del "%ROOT%\setup_tmp.txt" >nul 2>&1
REM If a CPU-only torch is present, uninstall it first so the CUDA wheel can be installed.
"%VPYTHON%" -c "import torch" >nul 2>&1
if not errorlevel 1 (
    call :warn "CPU-only torch detected - uninstalling before CUDA install..."
    "%VPIP%" uninstall -y torch torchvision torchaudio >> "%LOG%" 2>&1
)

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

REM flash-attn used to be installed here for ACE-Step. It went with it - and it
REM had never worked anyway: the pinned wheel was cp311 while this venv is
REM Python 3.10, so pip rejected it on every run. YuE2's FlashAttention 2 is
REM installed into WanGP's own venv in step 6, where the interpreter matches.

:after_torch

REM ---------------------------------------------------------------------------
REM STEP 4/7 - AI model repos
REM ---------------------------------------------------------------------------
call :bar 3
call :header 4 "Cloning AI model repos"

cd /d "%ROOT%"
set "CLONE_FAILS=0"

REM NOTE: applio/core.py is committed directly in this repo (upstream IAHispano/Applio
REM restructured their repo and removed core.py). No clone needed.
REM RC-stable-audio-tools (Foundation-1 instrument layers) and stage (drum
REM generation) used to be cloned here. Both were removed on 2026-09-21: the
REM Foundation panel could only produce 47-second clips and stage's upstream has
REM been dead for over a year. Together they cost 19 GB of disk and two more
REM venvs on incompatible CUDA builds, for two features nobody could finish a
REM track with.
call :clone_repo "SoulX-Singer"          "https://github.com/Soul-AILab/SoulX-Singer.git"

REM Download RVC predictor weights (rmvpe.pt, fcpe.pt) if not already present.
REM These are needed for vocal pitch extraction at inference time.
set "PREDICTORS_DIR=%ROOT%\rvc\models\predictors"
set "PREDICTORS_OK=1"
for %%F in (rmvpe.pt fcpe.pt) do (
    if not exist "%PREDICTORS_DIR%\%%F" (
        call :info "Downloading %%F from HuggingFace..."
        "%VPYTHON%" -c "import wget, os; os.makedirs(r'%PREDICTORS_DIR%', exist_ok=True); wget.download('https://huggingface.co/IAHispano/Applio/resolve/main/Resources/predictors/%%F', out=r'%PREDICTORS_DIR%\%%F')" >> "%LOG%" 2>&1
        if errorlevel 1 (
            call :warn "Failed to download %%F - inference will auto-retry on first use."
            set "PREDICTORS_OK=0"
        ) else (
            call :ok "Downloaded %%F"
        )
    ) else (
        call :skip "%%F already present."
    )
)

if "%CLONE_FAILS%"=="0" (
    call :step_done 4 "R_REPOS"
) else (
    call :warn "Some repos failed to clone (see above). You can clone them manually."
    set "R_REPOS=1"
)

REM ---------------------------------------------------------------------------
REM STEP 5/7 - WanGP / YuE2 (hosts the song-generation engine)
REM
REM YuE2 is not vendored. WanGP ships a supported in-process Python API and
REM Rhymix drives it from a persistent worker, so this installs WanGP as a
REM sibling of the repo rather than inside it.
REM
REM This is the song-generation engine. If it fails, song generation is
REM unavailable - everything else (training, inference, covers via voice
REM conversion, diarization) still works.
REM
REM LICENCE: YuE2 weights are CC BY-NC 4.0 (non-commercial) and WanGP's terms
REM require disclosing that this project uses it. See docs/SETUP_MODELS.md.
REM ---------------------------------------------------------------------------
call :bar 4
call :header 5 "Setting up WanGP / YuE2 (song generation)"

set "WANGP_DIR=%ROOT%..\WanGP"
set "WANGP_VENV=%WANGP_DIR%\.venv"
REM Pinned: WanGP's API and the YuE2 handler both move fast, and the flash-attn
REM wheel below is built against one exact torch build.
set "WANGP_REF=main"

if /i "%RHYMIX_SKIP_WANGP%"=="1" (
    call :skip "RHYMIX_SKIP_WANGP=1 - skipping YuE2 engine."
    set "R_WANGP=2"
    goto :wangp_done
)

if exist "%WANGP_DIR%\wgp.py" (
    call :skip "WanGP already present at %WANGP_DIR%"
) else (
    call :info "Cloning WanGP to %WANGP_DIR% ..."
    git clone --depth=1 --branch %WANGP_REF% https://github.com/deepbeepmeep/Wan2GP.git "%WANGP_DIR%" >> "%LOG%" 2>&1
    if errorlevel 1 (
        call :warn "Failed to clone WanGP - song generation will be unavailable."
        set "R_WANGP=1"
        goto :wangp_done
    )
)

if exist "%WANGP_VENV%\Scripts\python.exe" (
    call :skip "WanGP venv already exists."
) else (
    REM WanGP wants Python 3.11 on RTX 30XX-50XX. uv is far faster and can
    REM fetch 3.11 itself; fall back to the py launcher when it is absent.
    where uv >nul 2>&1
    if !ERRORLEVEL! equ 0 (
        call :info "Creating WanGP venv with uv (Python 3.11)..."
        uv venv "%WANGP_VENV%" --python 3.11 >> "%LOG%" 2>&1
    ) else (
        call :info "Creating WanGP venv with py -3.11..."
        py -3.11 -m venv "%WANGP_VENV%" >> "%LOG%" 2>&1
    )
    if errorlevel 1 (
        call :warn "Could not create the WanGP venv (Python 3.11 required) - skipping YuE2."
        set "R_WANGP=1"
        goto :wangp_done
    )
)

set "WANGP_PY=%WANGP_VENV%\Scripts\python.exe"
set "WANGP_PIP=%WANGP_VENV%\Scripts\pip.exe"
where uv >nul 2>&1
if !ERRORLEVEL! equ 0 (
    set "WANGP_INSTALL=uv pip install --python "%WANGP_PY%""
) else (
    set "WANGP_INSTALL="%WANGP_PIP%" install"
)

call :info "Installing torch 2.10.0 + cu130 (driver must report CUDA 13.x)..."
!WANGP_INSTALL! torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu130 >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "torch install failed for WanGP - skipping YuE2."
    set "R_WANGP=1"
    goto :wangp_done
)

call :info "Installing WanGP requirements (large - several minutes)..."
!WANGP_INSTALL! -r "%WANGP_DIR%\requirements.txt" >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "WanGP requirements failed - see setup.log."
    set "R_WANGP=1"
    goto :wangp_done
)

REM Triton 3.2 crashes YuE2's INT8 ConvRot kernels on RTX 30XX (no
REM triton.language.gather). The INT8 path is what fits the model in ~4.5 GB.
call :info "Installing triton-windows >=3.6,<3.7 (YuE2 INT8 kernels)..."
!WANGP_INSTALL! -U "triton-windows>=3.6,<3.7" >> "%LOG%" 2>&1
if errorlevel 1 call :warn "triton-windows failed - YuE2 INT8 kernels will be unavailable."

REM FlashAttention 2 unlocks lm_decoder_engine=vllm, which turns on the Triton
REM decoder kernels and roughly halves generation time. Without it YuE2 falls
REM back to SDPA and still runs, just slower. Wheel must match torch+cu+python.
set "WANGP_FATTN=https://github.com/sdbds/flash-attention-for-windows/releases/download/2.8.3/flash_attn-2.8.3%%2Bcu130torch2.10.0cxx11abiFALSEfullbackward-cp311-cp311-win_amd64.whl"
call :info "Installing FlashAttention 2 (enables the fast vllm engine)..."
!WANGP_INSTALL! --no-build-isolation "%WANGP_FATTN%" >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "flash-attn wheel failed - YuE2 will run on the slower 'cg' engine."
) else (
    call :ok "FlashAttention 2 installed - vllm engine available."
)

call :info "Configuring WanGP for 8 GB cards (vllm engine, audio profile 3)..."
"%WANGP_PY%" -c "import json,pathlib;p=pathlib.Path(r'%WANGP_DIR%')/'wgp_config.json';d=json.loads(p.read_text(encoding='utf-8')) if p.exists() else {};d['lm_decoder_engine']='vllm';d['audio_profile']=3;p.write_text(json.dumps(d,indent=4),encoding='utf-8')" >> "%LOG%" 2>&1
if errorlevel 1 (
    call :warn "Could not write wgp_config.json - set lm_decoder_engine=vllm manually."
) else (
    call :ok "WanGP configured."
)

call :ok "WanGP / YuE2 ready."
call :step_done 5 "R_WANGP"

:wangp_done

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

REM ---------------------------------------------------------------------------
REM Final bar + model weights reminder
REM ---------------------------------------------------------------------------
call :bar 8

echo.
echo   ---------------------------------------------------------------------------
echo   Model weights must be downloaded separately (Rhymix starts without them
echo   but those features will fail):
echo.
echo     YuE2 -^> downloaded on first use by WanGP into ../WanGP/ckpts/
echo             Weights are CC BY-NC 4.0 (non-commercial).
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
call :summary_row "5. WanGP / YuE2    " "%R_WANGP%"
call :summary_row "6. Frontend (npm)  " "%R_FRONTEND%"
call :summary_row "7. .env file       " "%R_ENV%"
echo ===========================================================================

set "ANY_FAIL=0"
for %%S in (%R_PREREQ% %R_VENV% %R_TORCH% %R_REPOS% %R_WANGP% %R_FRONTEND% %R_ENV%) do (
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
call :log "R_WANGP=%R_WANGP%  R_FRONTEND=%R_FRONTEND%  R_ENV=%R_ENV%"
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
