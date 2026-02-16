@echo off
setlocal
set ROOT=%~dp0

rem Stop anything already listening on our ports
for %%P in (5000 3001 8001) do (
  for /f "tokens=5" %%a in ('netstat -aon ^| findstr :%%P ^| findstr LISTENING') do (
    echo Stopping PID %%a on port %%P
    taskkill /F /PID %%a >nul 2>&1
  )
)

rem Start Flask backend
start "Rhymix Backend" cmd /k "cd /d %ROOT% && call venv\Scripts\activate && python app.py"

rem Start Voice->MIDI WebSocket service
start "Voice-MIDI WS" cmd /k "cd /d %ROOT% && call venv\Scripts\activate && python -m uvicorn backend.app.main:app --host 0.0.0.0 --port 8001"

rem Start React frontend
start "Rhymix Frontend" cmd /k "cd /d %ROOT%\frontend && npm start"

endlocal
