const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { app, BrowserWindow, ipcMain, shell } = require('electron')

const isDev = !app.isPackaged

if (isDev) {
  const devDataDir = path.join(os.tmpdir(), 'msw-overwatch-electron-dev')
  app.commandLine.appendSwitch('user-data-dir', devDataDir)
  app.setPath('userData', devDataDir)
  app.commandLine.appendSwitch('disk-cache-dir', path.join(devDataDir, 'Cache'))
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-http-cache')
}

/** GitHub Releases feed is embedded at build time via `build.publish` in package.json. */
function setupAutoUpdater() {
  if (isDev) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.checkForUpdatesAndNotify()
    const DAY_MS = 24 * 60 * 60 * 1000
    setInterval(() => autoUpdater.checkForUpdatesAndNotify(), DAY_MS)
  } catch (err) {
    console.error('[autoUpdater]', err)
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'icon.ico')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL('http://localhost:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

ipcMain.handle('app:getVersion', () => app.getVersion())

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
    const { autoUpdater } = require('electron-updater')
    await autoUpdater.checkForUpdatesAndNotify()
    return {
      ok: true,
      message: 'Update check started. You will be notified if an update is available.',
    }
  } catch (err) {
    return {
      ok: false,
      message: err?.message || 'Failed to check for updates.',
    }
  }
})

app.whenReady().then(() => {
  setupAutoUpdater()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
