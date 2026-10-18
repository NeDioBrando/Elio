@echo off
setlocal
cd /d "%~dp0"
set "ELIO_APP=elio.exe"
if not exist "%ELIO_APP%" (
  if exist "elio-agent.exe" (
    set "ELIO_APP=elio-agent.exe"
  ) else (
    echo elio.exe is missing. Check Windows Security Protection history.
    pause
    exit /b 1
  )
)
echo Starting elio...
start "" /D "%~dp0" "%~dp0%ELIO_APP%"
if errorlevel 1 (
  echo Windows could not start elio. Check Protection history for details.
  pause
  exit /b 1
)
