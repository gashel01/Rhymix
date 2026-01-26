@echo off
title Applio Vocal Processor - Development Mode

echo ================================================
echo     Vocal Processing Tool - Development Mode
echo ================================================

REM Check if Node.js and npm are installed
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Error: Node.js is not installed or not found in PATH.
    echo Please install Node.js from https://nodejs.org/
    goto end
)

REM Start the Flask backend first
cd singer_training_prep
start cmd /k "python app.py"
cd ..

REM Wait a moment for Flask to start
timeout /t 3 >nul

REM Configure Flask to serve static files and enable CORS properly
echo Flask API is running on http://localhost:5000

REM Run React in development mode with a different port
cd singer_training_prep\frontend
echo Setting up React development environment...

REM Check if react-scripts is installed
if not exist "node_modules\.bin\react-scripts.cmd" (
    echo Installing required npm packages...
    call npm install
)

REM Start React with a different port
set PORT=3001
echo Starting React development server on port %PORT%...
call npm run start

:end
echo -----------------------------------------------
echo Press any key to exit.
echo -----------------------------------------------
pause 