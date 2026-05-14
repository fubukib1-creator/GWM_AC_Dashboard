@echo off
REM ============================================================================
REM  GWM x INNOPOWER - Executive Dashboard - Refresh and Open
REM ============================================================================
REM  Double-click this file to:
REM    1. Pull a fresh snapshot from the GWM portal
REM    2. Start the local server on port 8766
REM    3. Open the executive dashboard in your browser
REM
REM  Requires:
REM    - scripts\credentials.json with your portal username and password
REM    - Internet access to ev.rpdservice.com
REM ============================================================================

setlocal
title GWM x INNOPOWER - Refresh and Open Executive Dashboard

cd /d "%~dp0"

echo.
echo  ============================================================
echo   GWM x INNOPOWER - Refresh and Open Executive Dashboard
echo  ============================================================
echo.

if not exist "scripts\pull-daily.ps1" (
  echo ERROR: scripts\pull-daily.ps1 not found.
  pause
  exit /b 1
)

if not exist "scripts\credentials.json" (
  echo ERROR: scripts\credentials.json not found.
  echo Copy scripts\credentials.example.json to scripts\credentials.json and
  echo fill in your portal username and password.
  echo.
  pause
  exit /b 1
)

echo  Step 1/2: Pulling fresh snapshot from portal...
echo  ----------------------------------------------
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\pull-daily.ps1"
set PULL_RC=%ERRORLEVEL%

if not %PULL_RC%==0 (
  echo.
  echo WARNING: snapshot pull exited with code %PULL_RC%.
  echo The dashboard will still open with the most recent existing snapshot.
  echo.
)

echo.
echo  Step 2/2: Starting executive dashboard server (port 8766)...
echo  ------------------------------------------------------------
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Dashboard\v4-gwm\serve.ps1"

echo.
echo  Server stopped.
echo  Press any key to close...
pause >nul
