@echo off
setlocal
cd /d "%~dp0"
set "SYNERIXCODE_APP=synerixcode.exe"
if not exist "%SYNERIXCODE_APP%" (
  if exist "synerixcode-agent.exe" (
    set "SYNERIXCODE_APP=synerixcode-agent.exe"
  ) else (
    echo synerixcode.exe is missing. Check Windows Security Protection history.
    pause
    exit /b 1
  )
)
echo Starting synerixcode...
start "" /D "%~dp0" "%~dp0%SYNERIXCODE_APP%"
if errorlevel 1 (
  echo Windows could not start synerixcode. Check Protection history for details.
  pause
  exit /b 1
)
