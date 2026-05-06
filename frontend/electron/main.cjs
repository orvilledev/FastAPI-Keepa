const path = require('node:path')
const os = require('node:os')
const { app, BrowserWindow, shell } = require('electron')

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
