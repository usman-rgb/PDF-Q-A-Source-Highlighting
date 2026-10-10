@echo off
setlocal
title DocMind Launcher

set "ROOT=%~dp0"
set "BACKEND=%ROOT%pdf-qa-demo\backend"
set "FRONTEND=%ROOT%pdf-qa-demo\frontend"

echo ====================================================
echo   DocMind: Starting Backend and Frontend together
echo ====================================================
echo.

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python was not found in PATH.
  echo Install Python 3.11+ and try again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Install Node.js 18+ and try again.
  pause
  exit /b 1
)

if not exist "%BACKEND%\main.py" (
  echo [ERROR] Backend folder was not found:
  echo %BACKEND%
  pause
  exit /b 1
)

if not exist "%FRONTEND%\package.json" (
  echo [ERROR] Frontend folder was not found:
  echo %FRONTEND%
  pause
  exit /b 1
)

if not exist "%FRONTEND%\node_modules" (
  echo [INFO] Frontend dependencies are missing. Installing them now...
  pushd "%FRONTEND%"
  call npm install
  if errorlevel 1 (
    popd
    echo [ERROR] Frontend dependency installation failed.
    pause
    exit /b 1
  )
  popd
)

start "DocMind Backend" cmd /k "cd /d ""%BACKEND%"" && python -m uvicorn main:app --reload --port 8000"
start "DocMind Frontend" cmd /k "cd /d ""%FRONTEND%"" && npm run dev"

echo Backend:  http://localhost:8000
echo Frontend: http://localhost:5173
echo.
echo Dono services apni alag windows mein start ho gayi hain.
echo Is window ko band karne ke liye koi bhi key press karein.
pause >nul
endlocal
