# Start Development Servers
# This script starts both backend and frontend servers

$ErrorActionPreference = "Stop"

Write-Host "[START] Starting Orbit Development Servers..." -ForegroundColor Cyan
Write-Host ""

# Get the script directory (project root)
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

# Check if .env files exist
$BackendEnv = Join-Path $BackendDir ".env"
$FrontendEnv = Join-Path $FrontendDir ".env"

if (-not (Test-Path $BackendEnv)) {
    Write-Host "[X] ERROR: Backend .env file not found at: $BackendEnv" -ForegroundColor Red
    Write-Host "   Please create the .env file with required configuration." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $FrontendEnv)) {
    Write-Host "[WARN] WARNING: Frontend .env file not found at: $FrontendEnv" -ForegroundColor Yellow
    Write-Host "   Frontend may not work correctly without environment variables." -ForegroundColor Yellow
}

# Check if ports are already in use
$Port8000 = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
$Port5173 = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue

if ($Port8000) {
    Write-Host "[WARN] WARNING: Port 8000 is already in use. Backend may fail to start." -ForegroundColor Yellow
    Write-Host "   Kill the process using: Get-Process -Id $($Port8000.OwningProcess) | Stop-Process" -ForegroundColor Yellow
}

if ($Port5173) {
    Write-Host "[WARN] WARNING: Port 5173 is already in use. Frontend may fail to start." -ForegroundColor Yellow
    Write-Host "   Kill the process using: Get-Process -Id $($Port5173.OwningProcess) | Stop-Process" -ForegroundColor Yellow
}

# Check Python dependencies
Write-Host "[PACKAGE] Checking Python dependencies..." -ForegroundColor Cyan
try {
    $null = python -c "import supabase" 2>&1
    Write-Host "[OK] Python dependencies OK" -ForegroundColor Green
} catch {
    Write-Host "[X] Python dependencies missing. Installing..." -ForegroundColor Yellow
    Set-Location $BackendDir
    python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Failed to install Python dependencies" -ForegroundColor Red
        exit 1
    }
    Write-Host "[OK] Python dependencies installed" -ForegroundColor Green
}

# Check Node dependencies
Write-Host "[PACKAGE] Checking Node dependencies..." -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "[WARN] node_modules not found. Installing..." -ForegroundColor Yellow
    Set-Location $FrontendDir
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[X] Failed to install Node dependencies" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "[TOOL] Starting Backend Server (Port 8000)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$BackendDir'; python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000" -WindowStyle Normal

Start-Sleep -Seconds 2

Write-Host "[TOOL] Starting Frontend Server (Port 5173)..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$FrontendDir'; npm run dev" -WindowStyle Normal

Write-Host ""
Write-Host "[OK] Servers starting in separate windows..." -ForegroundColor Green
Write-Host ""
Write-Host "[LOCATION] Backend:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "[LOCATION] Frontend: http://localhost:5173" -ForegroundColor Cyan
Write-Host "[LOCATION] API Docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "Press any key to exit this script (servers will continue running)..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
