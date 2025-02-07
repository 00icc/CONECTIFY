const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  checkInstallation: () => ipcRenderer.invoke('check-installation'),
  getPaths: () => ipcRenderer.invoke('get-paths'),
  savePaths: (paths) => ipcRenderer.invoke('save-paths', paths),
  bridgeOperation: async (action, data) => {
    try {
      const result = await ipcRenderer.invoke('bridge-operation', { action, data })
      if (!result.success) {
        throw new Error(result.message || 'Bridge operation failed')
      }
      return result
    } catch (error) {
      console.error('Bridge operation error:', error)
      throw error
    }
  },
  configureApp: async (app, settings) => {
    try {
      const result = await ipcRenderer.invoke('configure-app', { app, settings })
      if (!result.success) {
        throw new Error(result.message || 'Configuration failed')
      }
      return result
    } catch (error) {
      console.error('Configuration error:', error)
      throw error
    }
  },
  getBridgeStatus: async () => {
    try {
      const result = await ipcRenderer.invoke('get-bridge-status')
      if (!result.success) {
        throw new Error(result.message || 'Failed to get bridge status')
      }
      return result
    } catch (error) {
      console.error('Bridge status error:', error)
      throw error
    }
  }
})