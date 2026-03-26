@echo off
set "ROOT=C:\Users\gaeli\Downloads\Rhymix"
set "FRONTEND=%ROOT%\frontend"

start "Rhymix Backend API" cmd /k "cd /d "%ROOT%" && call venv\Scripts\activate && python -X faulthandler -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8002"
start "Rhymix App" cmd /k "cd /d "%ROOT%" && python app.py"

timeout /t 1 /nobreak >nul

start "Rhymix Frontend" cmd /k "cd /d "%FRONTEND%" && npm start"