@echo off
setlocal

REM ---------------------------------------------------------------------------
REM Rhymix - stop all dev services launched by run_all.bat
REM
REM Closes the three service windows by their titles, then falls back to
REM killing anything still listening on ports 5000, 8002, and 3001.
REM ---------------------------------------------------------------------------

echo.
echo ============================================================
echo   Rhymix - stopping all services
echo ============================================================
echo.

REM --- 1. Close the named cmd windows spawned by run_all.bat ---------------

echo [1/2] Closing launcher windows by title...
taskkill /FI "WINDOWTITLE eq Rhymix - Flask REST (:5000)*"  /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Rhymix - FastAPI WS (:8002)*"  /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq Rhymix - React dev (:3001)*"   /T /F >nul 2>&1

REM --- 2. Port sweep (catches orphans started some other way) --------------

echo [2/2] Sweeping ports 5000, 8002, 3001...
call :kill_port 5000
call :kill_port 8002
call :kill_port 3001

echo.
echo ============================================================
echo   Done. All Rhymix dev services stopped.
echo ============================================================
echo.

endlocal
exit /b 0


:kill_port
REM Kill the process (if any) listening on the given TCP port.
set "PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
    if not "%%P"=="0" (
        echo    port %PORT% -> killing PID %%P
        taskkill /PID %%P /T /F >nul 2>&1
    )
)
exit /b 0
