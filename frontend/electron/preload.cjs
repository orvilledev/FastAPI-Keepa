const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  getUpdateStatus: () => ipcRenderer.invoke('app:getUpdateStatus'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('app:update-status', handler)
    return () => ipcRenderer.removeListener('app:update-status', handler)
  },
  listPrinters: () => ipcRenderer.invoke('printer:list'),
  printZpl: (payload) => ipcRenderer.invoke('printer:printZpl', payload),
  showCapybaraReminder: (payload) => ipcRenderer.invoke('capybara:show', payload),
  onCapybaraDismissed: (callback) => {
    const handler = () => callback()
    ipcRenderer.on('capybara:dismissed', handler)
    return () => ipcRenderer.removeListener('capybara:dismissed', handler)
  },
  onCapybaraSnoozed: (callback) => {
    const handler = (_event, minutes) => callback(minutes)
    ipcRenderer.on('capybara:snoozed', handler)
    return () => ipcRenderer.removeListener('capybara:snoozed', handler)
  },
})
