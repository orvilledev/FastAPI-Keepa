@echo off
setlocal EnableExtensions

title MSW Overwatch - Dev Launcher

echo.
echo  MSW Overwatch - Development
echo  ===========================
echo.

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%backend"
set "FRONTEND_DIR=%PROJECT_ROOT%frontend"

if not exist "%BACKEND_DIR%\.env" (
    echo [ERROR] Backend .env not found:
    echo         %BACKEND_DIR%\.env
    echo.
    echo         Copy backend/.env.example and fill in your values.
    echo.
    pause
    exit /b 1
)

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Install Python 3 and try again.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Install Node.js and try again.
    echo.
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules\" (
    echo [INFO] Installing frontend dependencies - first run...
    pushd "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        popd
        pause
        exit /b 1
    )
    popd
    echo.
)

echo [START] Backend  - http://localhost:8000
start "MSW Overwatch - Backend" /D "%BACKEND_DIR%" cmd /k python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

timeout /t 2 /nobreak >nul

echo [START] Frontend - http://localhost:5173
start "MSW Overwatch - Frontend" /D "%FRONTEND_DIR%" cmd /k npm run dev

echo.
echo [WAIT]  Opening app in your browser...
timeout /t 5 /nobreak >nul
start "" "http://localhost:5173"

echo.
echo [OK]    Dev servers are running in separate windows.
echo.
echo         App:      http://localhost:5173
echo         API:      http://localhost:8000
echo         API docs: http://localhost:8000/docs
echo.
echo         To stop servers, close the Backend/Frontend windows
echo         or double-click stop-dev.bat
echo.
pause

endlocal
