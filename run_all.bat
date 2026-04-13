@echo off
setlocal

REM ---------------------------------------------------------------------------
REM Rhymix - one-click dev launcher (Windows)
REM
REM Starts all three services in separate cmd windows so you can watch each
REM log stream independently:
REM
REM   [1] Flask REST API       http://localhost:5000
REM   [2] FastAPI WebSocket    ws://localhost:8002/ws/voice_to_midi
REM   [3] React dev server     http://localhost:3001
REM
REM Close any window to stop that service.
REM ---------------------------------------------------------------------------

REM Resolve repo root from this script's location (no hardcoded paths).
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "FRONTEND=%ROOT%\frontend"
set "VENV=%ROOT%\venv"
set "ACTIVATE=%VENV%\Scripts\activate.bat"

echo.
echo ============================================================
echo   Rhymix - starting all services
echo   Repo: %ROOT%
echo ============================================================
echo.

REM --- Sanity checks --------------------------------------------------------

if not exist "%ACTIVATE%" (
    echo [ERROR] Python virtualenv not found at:
    echo         %VENV%
    echo.
    echo Create it first:
    echo     py -3.10 -m venv venv
    echo     venv\Scripts\activate
    echo     pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

if not exist "%ROOT%\app.py" (
    echo [ERROR] app.py not found in %ROOT%
    pause
    exit /b 1
)

if not exist "%FRONTEND%\package.json" (
    echo [ERROR] frontend\package.json not found.
    echo Did you run 'npm install' in the frontend directory?
    pause
    exit /b 1
)

if not exist "%ROOT%\.env" (
    echo [WARN]  No .env file found. Rhymix will use built-in defaults.
    echo         Copy .env.example to .env to customize settings.
    echo.
)

REM --- Launch ---------------------------------------------------------------
REM
REM start /D "<dir>"  = set the new window's starting directory
REM cmd /k "<cmd>"    = open a cmd that runs <cmd> and stays open afterwards
REM
REM Using /D avoids having to `cd /d "..."` inside the quoted /k command,
REM which sidesteps all the nested-quote pain that was breaking this script.

echo [1/3] Starting Flask REST API on port 5000...
start "Rhymix - Flask REST (:5000)" /D "%ROOT%" cmd /k "call "%ACTIVATE%" && python app.py"

echo [2/3] Starting FastAPI WebSocket on port 8002...
start "Rhymix - FastAPI WS (:8002)" /D "%ROOT%" cmd /k "call "%ACTIVATE%" && python -X faulthandler -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8002"

REM Give Python services a head start before the frontend tries to reach them.
timeout /t 2 /nobreak >nul

echo [3/3] Starting React dev server on port 3001...
start "Rhymix - React dev (:3001)" /D "%FRONTEND%" cmd /k "npm start"

echo.
echo ============================================================
echo   All services launched. Open:
echo     http://localhost:3001   (frontend)
echo     http://localhost:5000   (Flask REST)
echo     ws://localhost:8002     (FastAPI WebSocket)
echo.
echo   Close a window to stop that service.
echo ============================================================
echo.

endlocal
exit /b 0
