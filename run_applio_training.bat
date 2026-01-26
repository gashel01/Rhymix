@echo off  
REM This batch file runs the singer training app with Applio  
  
cd /d "%%~dp0"  
  
REM Set paths for Applio  
set PYTHONPATH=%C:\Users\gaeli\Downloads\singer_training_prep%\applio;%%PYTHONPATH%%  
  
REM Run the web app with Applio's Python  
applio\env\python.exe app.py  
  
REM If you need to debug the app  
REM pause 
