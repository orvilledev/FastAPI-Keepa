# Startup Troubleshooting Guide

## Common Issues and Solutions

### Issue 1: "ModuleNotFoundError: No module named 'supabase'"

**Cause:** Python dependencies are not installed or you're using a different Python environment.

**Solution:**
```powershell
cd backend
pip install -r requirements.txt
```

**Prevention:** Use a virtual environment:
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### Issue 2: "ERR_CONNECTION_REFUSED" on localhost:5173

**Cause:** Vite is only listening on IPv6 (`[::1]`) instead of IPv4 (`127.0.0.1`).

**Solution:** Already fixed in `vite.config.ts` with `host: '0.0.0.0'`.

**If it happens again:** Check `frontend/vite.config.ts` has:
```typescript
server: {
  host: '0.0.0.0',  // This line is critical
  port: 5173,
}
```

### Issue 3: "ValidationError" or missing environment variables

**Cause:** `.env` file not found because command was run from wrong directory.

**Solution:** 
- Always run commands from the correct directory (`backend/` or `frontend/`)
- Or use the startup scripts (`start-dev.ps1` or `start-dev.bat`)

**Prevention:** The improved `config.py` now finds `.env` relative to the backend directory, so it works regardless of where you run the command from.

### Issue 4: Port already in use

**Cause:** Previous server instances weren't properly closed.

**Solution:**
```powershell
# Find process using port 8000
Get-NetTCPConnection -LocalPort 8000 | Select-Object OwningProcess
# Kill it (replace PID with actual process ID)
Stop-Process -Id <PID>

# Or kill all Python processes (be careful!)
Get-Process python | Stop-Process
```

### Issue 5: Servers work one time but fail the next

**Root Causes:**
1. **No virtual environment** - Dependencies installed globally can conflict
2. **Working directory changes** - `.env` file not found (now fixed in config.py)
3. **Port conflicts** - Previous processes still running
4. **Different Python/Node versions** - Environment inconsistencies

**Prevention Checklist:**
- ✅ Use virtual environment for Python
- ✅ Use startup scripts (they ensure correct directories)
- ✅ Check ports before starting
- ✅ Keep Node.js and Python versions consistent

## Quick Fix Commands

```powershell
# Kill processes on ports
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }

# Reinstall dependencies
cd backend
pip install -r requirements.txt
cd ../frontend
npm install

# Start servers (use startup script)
.\start-dev.ps1
```

## Best Practices

1. **Always use the startup scripts** - They handle directory changes and checks automatically
2. **Use a virtual environment** - Prevents dependency conflicts
3. **Check ports before starting** - Avoid conflicts
4. **Keep .env files in correct locations** - `backend/.env` and `frontend/.env`
5. **Close servers properly** - Use Ctrl+C in the terminal windows

## Using the Development Scripts

### Start Servers

**PowerShell (Recommended):**
```powershell
.\start-dev.ps1
```

**Batch File (Alternative):**
```cmd
start-dev.bat
```

Both scripts will:
- ✅ Check for `.env` files
- ✅ Check for port conflicts
- ✅ Verify/install dependencies
- ✅ Start both servers in separate windows
- ✅ Display helpful URLs

### Check Server Status

**PowerShell:**
```powershell
.\check-dev.ps1
```

This script will show:
- ✅ Which servers are running
- ✅ Process IDs (PIDs)
- ✅ Port numbers
- ✅ Accessible URLs

### Stop Servers

**PowerShell (Recommended):**
```powershell
.\stop-dev.ps1
```

**Batch File (Alternative):**
```cmd
stop-dev.bat
```

Both scripts will:
- ✅ Stop backend server (port 8000)
- ✅ Stop frontend server (port 5173)
- ✅ Show status messages
- ✅ Handle cases where servers aren't running
