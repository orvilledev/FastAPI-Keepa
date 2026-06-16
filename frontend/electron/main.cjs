const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
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
    presentUpdateStatus({
      phase: 'downloading',
      percent: 0,
      version: info?.version,
    })
  })

  updater.on('update-not-available', () => {
    if (userRequestedUpdateCheck) {
      presentUpdateStatus({
        phase: 'idle',
        message: 'You are on the latest version.',
      })
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
  void updater.checkForUpdates().catch((err) => {
    console.error('[autoUpdater] startup check failed', err)
  })
  const DAY_MS = 24 * 60 * 60 * 1000
  setInterval(() => {
    void updater.checkForUpdates().catch((err) => {
      console.error('[autoUpdater] scheduled check failed', err)
    })
  }, DAY_MS)
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
 * Send raw ZPL to a Zebra printer (TCP port 9100 by default).
 */
ipcMain.handle('printer:printZpl', async (_event, payload) => {
  const host = String(payload?.host || '').trim()
  const port = Number(payload?.port) || 9100
  const zpl = String(payload?.zpl || '')
  if (!host) {
    return { ok: false, message: 'Printer host/IP is required.' }
  }
  if (!zpl.trim()) {
    return { ok: false, message: 'No label data to print.' }
  }

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const finish = (result) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // ignore
      }
      resolve(result)
    }

    socket.setTimeout(8000)
    socket.on('timeout', () => finish({ ok: false, message: 'Printer connection timed out.' }))
    socket.on('error', (err) =>
      finish({ ok: false, message: err?.message || 'Failed to connect to printer.' })
    )
    socket.connect(port, host, () => {
      socket.write(zpl, 'utf8', () => {
        socket.end()
        finish({ ok: true, message: 'Label sent to printer.' })
      })
    })
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
    userRequestedUpdateCheck = true
    presentUpdateStatus({ phase: 'checking', percent: 0 })
    await updater.checkForUpdates()
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
