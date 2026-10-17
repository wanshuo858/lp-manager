@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing required packages...
  call npm install
  if errorlevel 1 (echo Installation failed. Check internet and Node.js, then retry.& pause & exit /b 1)
)
start "LP Manager" http://127.0.0.1:5173
call npm run dev
pause
