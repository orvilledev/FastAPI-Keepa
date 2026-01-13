# Check Development Server Status
# This script checks if backend and frontend servers are running

Write-Host "[CHECK] Checking Orbit Development Server Status..." -ForegroundColor Cyan
Write-Host ""

$backend = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
$frontend = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue

# Check Backend
if ($backend) {
    $backendPid = $backend.OwningProcess
    $proc = Get-Process -Id $backendPid -ErrorAction SilentlyContinue
    Write-Host "[OK] Backend is RUNNING" -ForegroundColor Green
    Write-Host "   Port: 8000" -ForegroundColor Gray
    Write-Host "   PID: $backendPid ($($proc.ProcessName))" -ForegroundColor Gray
    Write-Host "   URL: http://localhost:8000" -ForegroundColor Gray
    Write-Host "   Docs: http://localhost:8000/docs" -ForegroundColor Gray
} else {
    Write-Host "[X] Backend is NOT running (Port 8000)" -ForegroundColor Red
}

Write-Host ""

# Check Frontend
if ($frontend) {
    $frontendPid = $frontend.OwningProcess
    $proc = Get-Process -Id $frontendPid -ErrorAction SilentlyContinue
    Write-Host "[OK] Frontend is RUNNING" -ForegroundColor Green
    Write-Host "   Port: 5173" -ForegroundColor Gray
    Write-Host "   PID: $frontendPid ($($proc.ProcessName))" -ForegroundColor Gray
    Write-Host "   URL: http://localhost:5173" -ForegroundColor Gray
} else {
    Write-Host "[X] Frontend is NOT running (Port 5173)" -ForegroundColor Red
}

Write-Host ""

# Summary
if ($backend -and $frontend) {
    Write-Host "[OK] Both servers are running!" -ForegroundColor Green
} elseif ($backend -or $frontend) {
    Write-Host "[WARN] Only one server is running" -ForegroundColor Yellow
} else {
    Write-Host "[X] No servers are running" -ForegroundColor Red
}

Write-Host ""
