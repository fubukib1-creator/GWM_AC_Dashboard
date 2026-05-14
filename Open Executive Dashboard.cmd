@echo off
REM ============================================================================
REM  GWM x INNOPOWER - Executive Dashboard Launcher (v4-gwm)
REM ============================================================================
REM  Double-click this file to start the executive dashboard.
REM  - Starts a tiny local HTTP server on port 8766
REM  - Opens the executive dashboard in your default browser
REM  - Close this window to stop the server
REM
REM  Intended for presenting installation progress to GWM executives.
REM  No SLA breach data is shown; five executive KPIs only.
REM
REM  Can be run alongside "Open Operation Dashboard.cmd" (different ports).
REM ============================================================================

setlocal
title GWM x INNOPOWER - Executive Dashboard

cd /d "%~dp0"

echo.
echo  ============================================================
echo   GWM x INNOPOWER - Executive Progress Dashboard (v4-gwm)
echo  ============================================================
echo.
echo   Starting local server on port 8766...
echo   The dashboard will open in your default browser shortly.
echo.
echo   To stop the server: close this window.
echo.

if not exist "Dashboard\v4-gwm\serve.ps1" (
  echo ERROR: Dashboard\v4-gwm\serve.ps1 not found.
  echo This launcher must live next to the Dashboard folder.
  echo.
  pause
  exit /b 1
)

if not exist "data\snapshots" (
  echo WARNING: data\snapshots\ does not exist yet.
  echo Run "Refresh and Open Executive Dashboard.cmd" to fetch the first snapshot.
  echo.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Dashboard\v4-gwm\serve.ps1"

echo.
echo  Server stopped.
echo  Press any key to close this window...
pause >nul
