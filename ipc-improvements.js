const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Export the enhanced IPC handler
function handleIpc(channel, handler) {
  if (!ipcMain) {
    throw new Error('ipcMain is not available');
  }

  ipcMain.handle(channel, async (event, data, ...rest) => {
    const startTime = Date.now();
    try {
      const result = await handler(event, data, ...rest);
      return result;
    } catch (error) {
      console.error(`IPC ${channel} failed:`, error);
      return {
        success: false,
        errorCode: error.code || 'IPC_HANDLER_ERROR',
        message: error.message
      };
    }
  });
}

module.exports = {
  handleIpc
};
  
  // Create your main application window
  function createWindow() {
    const win = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js')
      }
    });
    
    win.loadFile('index.html');
  }
  
  app.whenReady().then(() => {
    createWindow();
  
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  
  // Register IPC handlers using the enhanced handler
  
  // Handler for 'check-installation'
  handleIpc("check-installation", async (event, input) => {
    const fs = require('fs');
    const checks = [];
  
    // Assume getPaths is an existing function or another IPC channel
    const paths = await ipcMain.handle('get-paths');
  
    try {
      // Check After Effects
      if (fs.existsSync(paths.afterEffects)) {
        checks.push({ app: "After Effects", status: true });
      } else {
        checks.push({
          app: "After Effects",
          status: false,
          error: "Application not found at specified path"
        });
      }
  
      // Check DaVinci Resolve
      if (fs.existsSync(paths.resolve)) {
        checks.push({ app: "DaVinci Resolve", status: true });
      } else {
        checks.push({
          app: "DaVinci Resolve",
          status: false,
          error: "Application not found at specified path"
        });
      }
  
      return {
        success: true,
        checks: checks
      };
    } catch (error) {
      return {
        success: false,
        checks: [],
        error: `Installation check failed: ${error.message}`
      };
    }
  });
  
  // Handler for 'configure-app'
  handleIpc("configure-app", async (event, { app: appName, settings }) => {
    const fs = require('fs');
    const proc = require('child_process');
    const path = require('path');
  
    // Assume getPaths is an existing function or IPC channel that returns correct paths
    const paths = await ipcMain.handle('get-paths');
  
    if (appName === 'After Effects') {
      const scriptPath = path.join(__dirname, 'bridge', 'scripts', 'ae-script.jsx');
      if (!fs.existsSync(scriptPath)) {
        throw new Error('After Effects script not found');
      }
  
      // Run the configuration script using spawn
      const processInstance = proc.spawn(paths.afterEffects, ['-r', scriptPath]);
      await new Promise((resolve, reject) => {
        processInstance.on('exit', code => {
          if (code === 0) resolve();
          else reject(new Error(`After Effects configuration failed with code ${code}`));
        });
        processInstance.on('error', reject);
      });
  
    } else if (appName === 'DaVinci Resolve') {
      const scriptPath = path.join(__dirname, 'bridge', 'scripts', 'resolve-bridge.lua');
      if (!fs.existsSync(scriptPath)) {
        throw new Error('DaVinci Resolve script not found');
      }
  
      const resolveScriptsDir = path.join(process.env.HOME, 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts');
      fs.copyFileSync(scriptPath, path.join(resolveScriptsDir, 'resolve-bridge.lua'));
  
    } else {
      throw new Error('Invalid application specified');
    }
  
    return { success: true, message: `${appName} configured successfully` };
  });
  
  // Add additional IPC channel registrations as necessary using handleIpc