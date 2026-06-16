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

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.on('did-finish-load', () => {
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

  const scriptPath = path.join(__dirname, 'raw-print.ps1')

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
