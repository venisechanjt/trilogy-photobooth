@echo off
title trilogy photobooth
cd /d "%~dp0"

rem ---- Double-click this file to start the photobooth for an event ----

rem Install packages the first time
if not exist node_modules (
  echo Installing packages, this takes a minute the first time...
  call npm install
)

rem Already running (e.g. started earlier)? Then just open it.
curl -s -o nul http://localhost:3000/api/status && goto ready

rem Start the booth (print mode) in its own window. Keep that window open while the booth runs.
start "trilogy photobooth server" /min cmd /k npm start

rem Wait until the booth is ready (up to 40 seconds)
echo Starting the photobooth...
set /a tries=0
:wait
timeout /t 1 /nobreak >nul
curl -s -o nul http://localhost:3000/api/status && goto ready
set /a tries+=1
if %tries% lss 40 goto wait
echo.
echo The booth didn't start. Open the "trilogy photobooth server" window to see the error.
pause
exit /b 1

:ready
rem Open full screen in Chrome, or Edge if Chrome isn't installed.
rem A separate browser profile makes it always open full screen and remember the camera permission.
set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER%" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
start "" "%BROWSER%" --kiosk --no-first-run --user-data-dir="%LocalAppData%\trilogy-photobooth-browser" http://localhost:3000

rem To finish: press Alt + F4 to close the full-screen booth, then close the server window.
