# Stop Development Servers
# This script kills processes running on ports 8000 (backend) and 5173 (frontend)

Write-Host "[STOP] Stopping Orbit Development Servers..." -ForegroundColor Yellow
Write-Host ""

# Stop Backend (Port 8000)
$backend = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($backend) {
    $backendPid = $backend.OwningProcess
    $proc = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
    Write-Host "[TOOL] Stopping Backend Server (Port 8000, PID: $backendPid)..." -ForegroundColor Cyan
    Stop-Process -Id $backendPid -Force -ErrorAction SilentlyContinue
    Write-Host "   [OK] Backend stopped" -ForegroundColor Green
} else {
    Write-Host "   [INFO] Backend not running on port 8000" -ForegroundColor Gray
}

# Stop Frontend (Port 5173)
$frontend = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($frontend) {
    $frontendPid = $frontend.OwningProcess
    $proc = Get-Process -Id $frontendPid -ErrorAction SilentlyContinue
    Write-Host "[TOOL] Stopping Frontend Server (Port 5173, PID: $frontendPid)..." -ForegroundColor Cyan
    Stop-Process -Id $frontendPid -Force -ErrorAction SilentlyContinue
    Write-Host "   [OK] Frontend stopped" -ForegroundColor Green
} else {
    Write-Host "   [INFO] Frontend not running on port 5173" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[OK] Done! All servers stopped." -ForegroundColor Green
