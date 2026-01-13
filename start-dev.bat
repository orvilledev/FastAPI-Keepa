@echo off
REM Start Development Servers
REM This script starts both backend and frontend servers

echo.
echo 🚀 Starting Orbit Development Servers...
echo.

REM Get the script directory (project root)
set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"

REM Check if .env files exist
if not exist "%BACKEND_DIR%\.env" (
    echo ❌ ERROR: Backend .env file not found at: %BACKEND_DIR%\.env
    echo    Please create the .env file with required configuration.
    pause
    exit /b 1
)

REM Start Backend
echo 🔧 Starting Backend Server (Port 8000)...
start "Backend Server" cmd /k "cd /d %BACKEND_DIR% && python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

timeout /t 2 /nobreak >nul

REM Start Frontend
echo 🔧 Starting Frontend Server (Port 5173)...
start "Frontend Server" cmd /k "cd /d %FRONTEND_DIR% && npm run dev"

echo.
echo ✅ Servers starting in separate windows...
echo.
echo 📍 Backend:  http://localhost:8000
echo 📍 Frontend: http://localhost:5173
echo 📍 API Docs: http://localhost:8000/docs
echo.
pause
