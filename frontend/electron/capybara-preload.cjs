const { contextBridge, ipcRenderer } = require('electron')

/** Preload for the always-on-top capybara reminder window only. */
contextBridge.exposeInMainWorld('capybaraOverlay', {
  getPayload: () => ipcRenderer.invoke('capybara:getPayload'),
  onUpdate: (callback) => {
    const handler = (_event, payload) => callback(payload)
    ipcRenderer.on('capybara:update', handler)
    return () => ipcRenderer.removeListener('capybara:update', handler)
  },
  dismiss: () => ipcRenderer.send('capybara:dismiss'),
  snooze: (minutes) => ipcRenderer.send('capybara:snooze', minutes),
})
