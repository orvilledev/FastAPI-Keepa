const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { app, BrowserWindow, ipcMain, shell } = require('electron')

const isDev = !app.isPackaged

app.setName('MSW Overwatch')

if (isDev) {
  const devDataDir = path.join(os.tmpdir(), 'msw-overwatch-electron-dev')
  app.commandLine.appendSwitch('user-data-dir', devDataDir)
  app.setPath('userData', devDataDir)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(devDataDir, 'Cache'))
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-http-cache')
}

let mainWindow = null
let autoUpdater = null
let updaterEventsWired = false
let userRequestedUpdateCheck = false
let lastUpdateStatus = { phase: 'idle' }

const UPDATE_CACHE_TTL_MS = 15 * 60 * 1000

function resolveRawPrintScriptPath() {
  const candidates = [
    path.join(__dirname, 'raw-print.ps1').replace('app.asar', 'app.asar.unpacked'),
    path.join(__dirname, 'raw-print.ps1'),
  ]
  if (app.isPackaged && process.resourcesPath) {
    candidates.push(
      path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'raw-print.ps1')
    )
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

let cachedRawPrintScriptPath = null

function getRawPrintScriptPath() {
  if (!cachedRawPrintScriptPath || !fs.existsSync(cachedRawPrintScriptPath)) {
    cachedRawPrintScriptPath = resolveRawPrintScriptPath()
  }
  return cachedRawPrintScriptPath
}

function updateCachePath() {
  return path.join(app.getPath('userData'), 'update-check-cache.json')
}

function readUpdateCache() {
  try {
    return JSON.parse(fs.readFileSync(updateCachePath(), 'utf8'))
  } catch {
    return null
  }
}

function writeUpdateCache(data) {
  try {
    fs.writeFileSync(updateCachePath(), JSON.stringify(data))
  } catch (err) {
    console.error('[autoUpdater] could not write update cache', err)
  }
}

function isUpdateCacheFresh(cache) {
  if (!cache?.checkedAt || cache.version !== app.getVersion()) return false
  return Date.now() - cache.checkedAt < UPDATE_CACHE_TTL_MS
}

/** Block electron-updater's bottom-left Windows toast; we show a centered in-app overlay instead. */
function suppressNativeUpdateNotifications() {
  if (isDev) return
  try {
    const { Notification } = require('electron')
    const originalShow = Notification.prototype.show
    Notification.prototype.show = function patchedShow() {
      const title = String(this.title || '').toLowerCase()
      const body = String(this.body || '').toLowerCase()
      const isUpdaterToast =
        title.includes('update is ready') ||
        body.includes('has been downloaded') ||
        body.includes('automatically installed on exit')
      if (isUpdaterToast) return
      return originalShow.call(this)
    }
  } catch (err) {
    console.error('[autoUpdater] could not patch Notification.show', err)
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendUpdateStatus(payload) {
  lastUpdateStatus = payload
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('app:update-status', payload)
}

function presentUpdateStatus(payload) {
  sendUpdateStatus(payload)
  if (payload.phase === 'downloading' || payload.phase === 'ready' || payload.phase === 'installing') {
    focusMainWindow()
  }
}

function getAutoUpdater() {
  if (isDev) return null
  if (!autoUpdater) {
    autoUpdater = require('electron-updater').autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = false
    if ('disableNotifications' in autoUpdater) {
      autoUpdater.disableNotifications = true
    }
  }
  if (!updaterEventsWired) {
    wireAutoUpdaterEvents(autoUpdater)
    updaterEventsWired = true
  }
  return autoUpdater
}

function wireAutoUpdaterEvents(updater) {
  updater.on('checking-for-update', () => {
    if (userRequestedUpdateCheck) {
      presentUpdateStatus({ phase: 'checking', percent: 0 })
    }
  })

  updater.on('update-available', (info) => {
    writeUpdateCache({
      version: app.getVersion(),
      noUpdate: false,
      checkedAt: Date.now(),
      availableVersion: info?.version,
    })
    presentUpdateStatus({
      phase: 'downloading',
      percent: 0,
      version: info?.version,
    })
  })

  updater.on('update-not-available', () => {
    writeUpdateCache({
      version: app.getVersion(),
      noUpdate: true,
      checkedAt: Date.now(),
    })
    if (userRequestedUpdateCheck) {
      presentUpdateStatus({
        phase: 'uptodate',
        percent: 100,
        version: app.getVersion(),
        message: `You are on the latest version (${app.getVersion()}).`,
      })
    } else {
      lastUpdateStatus = { phase: 'idle' }
    }
    userRequestedUpdateCheck = false
  })

  updater.on('download-progress', (progress) => {
    presentUpdateStatus({
      phase: 'downloading',
      percent: Math.round(progress?.percent ?? 0),
      version: progress?.version,
    })
  })

  updater.on('update-downloaded', (info) => {
    userRequestedUpdateCheck = false
    presentUpdateStatus({
      phase: 'ready',
      percent: 100,
      version: info?.version,
    })
  })

  updater.on('error', (err) => {
    userRequestedUpdateCheck = false
    presentUpdateStatus({
      phase: 'error',
      message: err?.message || 'Failed to download update.',
    })
  })
}

/** GitHub Releases feed is embedded at build time via `build.publish` in package.json. */
function setupAutoUpdater() {
  if (isDev) return
  const updater = getAutoUpdater()
  if (!updater) return

  const runBackgroundCheck = () => {
    void updater.checkForUpdates().catch((err) => {
      console.error('[autoUpdater] background check failed', err)
    })
  }

  // Defer the first check so startup and sign-in are not blocked on GitHub.
  setTimeout(runBackgroundCheck, 8_000)

  const DAY_MS = 24 * 60 * 60 * 1000
  setInterval(runBackgroundCheck, DAY_MS)
}

const RENDERER_INDEX = path.join(__dirname, '..', 'dist', 'index.html')

function loadRenderer(win) {
  if (isDev) {
    void win.loadURL('http://localhost:5173')
  } else {
    void win.loadFile(RENDERER_INDEX)
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Replace a blank window with a visible, actionable error page when the
 * renderer fails to load (e.g. a broken install/update left resources missing).
 */
function showRendererError(win, info) {
  if (!win || win.isDestroyed()) return
  const { pathToFileURL } = require('node:url')
  const retryHref = isDev ? 'http://localhost:5173' : pathToFileURL(RENDERER_INDEX).href
  const code = escapeHtml(info?.errorCode ?? '')
  const desc = escapeHtml(info?.errorDescription || 'The app could not load its content.')
  const version = escapeHtml(app.getVersion())
  const html = `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f8f8; color: #2d2d2d;
    margin: 0; height: 100vh; display: flex; align-items: center; justify-content: center; }
  .card { max-width: 520px; padding: 32px 36px; background: #fff; border: 1px solid #e5e5e5;
    border-radius: 12px; box-shadow: 0 1px 4px rgba(0,0,0,.06); text-align: center; }
  h1 { font-size: 18px; margin: 0 0 8px; color: #404040; }
  p { font-size: 13px; line-height: 1.5; color: #555; margin: 0 0 16px; }
  .retry { display: inline-block; background: #404040; color: #fff; text-decoration: none;
    padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; }
  .retry:hover { background: #2d2d2d; }
  .detail { margin-top: 18px; font-size: 11px; color: #999; font-family: monospace; }
</style></head>
<body><div class="card">
  <h1>MSW Overwatch couldn't load</h1>
  <p>The app started but its content failed to load. This can happen right after an
  interrupted update. Click Retry — if it keeps happening, reinstall the latest version
  from a fresh installer.</p>
  <a class="retry" href="${retryHref}">Retry</a>
  <div class="detail">v${version} &middot; ${code} ${desc}</div>
</div></body></html>`
  void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'MSW Overwatch',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = win

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  loadRenderer(win)

  let rendererLoadAttempts = 0

  // Retry transient load failures, then surface a visible error instead of a blank window.
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    // -3 is ERR_ABORTED (e.g. a superseded navigation); not a real failure.
    if (!isMainFrame || errorCode === -3) return
    rendererLoadAttempts += 1
    if (rendererLoadAttempts <= 2) {
      setTimeout(() => loadRenderer(win), 600)
      return
    }
    console.error('[renderer] load failed', errorCode, errorDescription)
    showRendererError(win, { errorCode, errorDescription })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone', details?.reason)
    showRendererError(win, {
      errorCode: details?.reason || 'crashed',
      errorDescription: 'The display process stopped unexpectedly.',
    })
  })

  win.webContents.on('did-finish-load', () => {
    rendererLoadAttempts = 0
    if (lastUpdateStatus.phase !== 'idle') {
      sendUpdateStatus(lastUpdateStatus)
      if (lastUpdateStatus.phase === 'ready' || lastUpdateStatus.phase === 'downloading') {
        focusMainWindow()
      }
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
}

ipcMain.handle('app:getVersion', () => app.getVersion())

ipcMain.handle('app:getUpdateStatus', () => lastUpdateStatus)

/**
 * List printers the OS already knows about (USB Zebra printers installed via
 * their Windows driver show up here automatically once plugged in).
 */
ipcMain.handle('printer:list', async () => {
  try {
    const wc = mainWindow?.webContents
    if (!wc) return { ok: false, message: 'Window not ready.', printers: [] }
    const printers = await wc.getPrintersAsync()
    return {
      ok: true,
      printers: printers.map((p) => ({
        name: p.name,
        displayName: p.displayName || p.name,
        isDefault: Boolean(p.isDefault),
      })),
    }
  } catch (err) {
    return { ok: false, message: err?.message || 'Failed to list printers.', printers: [] }
  }
})

/**
 * Send raw ZPL to an OS-installed (USB) Zebra printer by name. On Windows this
 * pushes the bytes straight through the print spooler's RAW datatype so the
 * driver does not rasterize/alter the ZPL.
 */
ipcMain.handle('printer:printZpl', async (_event, payload) => {
  const printerName = String(payload?.printerName || '').trim()
  const zpl = String(payload?.zpl || '')
  if (!printerName) {
    return { ok: false, message: 'Select a printer first.' }
  }
  if (!zpl.trim()) {
    return { ok: false, message: 'No label data to print.' }
  }
  if (process.platform !== 'win32') {
    return { ok: false, message: 'Direct printing is only supported on Windows.' }
  }

  const tmpFile = path.join(os.tmpdir(), `msw-zpl-${Date.now()}-${process.pid}.txt`)
  try {
    fs.writeFileSync(tmpFile, zpl, 'latin1')
  } catch (err) {
    return { ok: false, message: err?.message || 'Could not stage label data.' }
  }

  // PowerShell cannot execute scripts inside app.asar; asarUnpack copies this file
  // to app.asar.unpacked where the OS can read it.
  let scriptPath = getRawPrintScriptPath()
  if (!fs.existsSync(scriptPath)) {
    cachedRawPrintScriptPath = null
    scriptPath = getRawPrintScriptPath()
    if (!fs.existsSync(scriptPath)) {
      return { ok: false, message: `Print script not found: ${scriptPath}` }
    }
  }

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      {
        windowsHide: true,
        timeout: 15000,
        env: { ...process.env, ZPL_PRINTER: printerName, ZPL_FILE: tmpFile },
      },
      (err, _stdout, stderr) => {
        try {
          fs.unlinkSync(tmpFile)
        } catch {
          // ignore cleanup failure
        }
        if (err) {
          const detail = String(stderr || err.message || '').trim()
          resolve({ ok: false, message: detail || 'Print failed.' })
          return
        }
        resolve({ ok: true, message: 'Label sent to printer.' })
      }
    )
  })
})

ipcMain.handle('app:checkForUpdates', async () => {
  if (isDev) {
    return {
      ok: false,
      message: 'Update checks are only available in installed desktop builds.',
    }
  }

  try {
    const updater = getAutoUpdater()
    if (!updater) {
      return { ok: false, message: 'Auto-updater is not available.' }
    }

    if (lastUpdateStatus.phase === 'ready') {
      presentUpdateStatus(lastUpdateStatus)
      return { ok: true, message: 'Update ready to install.' }
    }

    userRequestedUpdateCheck = true

    const cache = readUpdateCache()
    if (cache?.noUpdate && isUpdateCacheFresh(cache)) {
      userRequestedUpdateCheck = false
      presentUpdateStatus({
        phase: 'uptodate',
        percent: 100,
        version: app.getVersion(),
        message: `You are on the latest version (${app.getVersion()}).`,
      })
      void updater.checkForUpdates().catch((err) => {
        console.error('[autoUpdater] refresh check failed', err)
      })
      return { ok: true, message: 'You are on the latest version.' }
    }

    presentUpdateStatus({ phase: 'checking', percent: 0 })
    void updater.checkForUpdates().catch((err) => {
      userRequestedUpdateCheck = false
      presentUpdateStatus({
        phase: 'error',
        message: err?.message || 'Failed to check for updates.',
      })
    })
    return {
      ok: true,
      message: 'Checking for updates…',
    }
  } catch (err) {
    userRequestedUpdateCheck = false
    presentUpdateStatus({
      phase: 'error',
      message: err?.message || 'Failed to check for updates.',
    })
    return {
      ok: false,
      message: err?.message || 'Failed to check for updates.',
    }
  }
})

ipcMain.handle('app:installUpdate', async () => {
  if (isDev) {
    return { ok: false, message: 'Install is only available in packaged builds.' }
  }
  try {
    const updater = getAutoUpdater()
    if (!updater) {
      return { ok: false, message: 'Auto-updater is not available.' }
    }
    presentUpdateStatus({ phase: 'installing', percent: 100 })
    setImmediate(() => {
      updater.quitAndInstall(false, true)
    })
    return { ok: true }
  } catch (err) {
    presentUpdateStatus({
      phase: 'error',
      message: err?.message || 'Failed to install update.',
    })
    return { ok: false, message: err?.message || 'Failed to install update.' }
  }
})

suppressNativeUpdateNotifications()

app.whenReady().then(() => {
  createWindow()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
