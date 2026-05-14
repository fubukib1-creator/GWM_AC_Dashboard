@echo off
REM ============================================================================
REM  INNOPOWER x GWM - Operation Dashboard Launcher (v3)
REM ============================================================================
REM  Double-click this file to start the operation dashboard.
REM  - Starts a tiny local HTTP server on port 8765
REM  - Opens the operation dashboard (Thai/EN, full SLA + categorisation)
REM  - Close this window to stop the server
REM
REM  Can be run alongside "Open Executive Dashboard.cmd" (different ports).
REM ============================================================================

setlocal
title INNOPOWER x GWM - Operation Dashboard

cd /d "%~dp0"

echo.
echo  ============================================================
echo   INNOPOWER x GWM - Operation Dashboard (v3)
echo  ============================================================
echo.
echo   Starting local server on port 8765...
echo   The dashboard will open in your default browser shortly.
echo.
echo   To stop the server: close this window.
echo.

if not exist "Dashboard\v3\serve.ps1" (
  echo ERROR: Dashboard\v3\serve.ps1 not found.
  echo This launcher must live next to the Dashboard folder.
  echo.
  pause
  exit /b 1
)

if not exist "data\snapshots" (
  echo WARNING: data\snapshots\ does not exist yet.
  echo Run "Refresh and Open Operation Dashboard.cmd" to fetch the first snapshot.
  echo.
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "Dashboard\v3\serve.ps1"

echo.
echo  Server stopped.
echo  Press any key to close this window...
pause >nul
