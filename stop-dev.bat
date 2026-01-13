@echo off
REM Stop Development Servers
REM This script kills processes running on ports 8000 (backend) and 5173 (frontend)

echo.
echo 🛑 Stopping Orbit Development Servers...
echo.

REM Kill processes on port 8000 (Backend)
echo 🔧 Stopping Backend Server (Port 8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    echo    Killing Backend (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo    ⚠️  Could not kill process %%a
    ) else (
        echo    ✅ Backend stopped
    )
)

REM Kill processes on port 5173 (Frontend)
echo 🔧 Stopping Frontend Server (Port 5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    echo    Killing Frontend (PID: %%a)...
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo    ⚠️  Could not kill process %%a
    ) else (
        echo    ✅ Frontend stopped
    )
)

echo.
echo ✅ Done! All servers stopped.
echo.
pause
