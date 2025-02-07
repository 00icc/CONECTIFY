"use strict";

const { app, BrowserWindow, ipcMain, session } = require("electron");
const path = require("path");
const { format: formatUrl } = require("url");
const logger = require("./logger");
const { validateIpcInput } = require("./validation");
const { handleIpc } = require('./ipc-improvements');

let mainWindow;
let bridgeProcesses = new Set();
let bridgeRunning = false;

/**
 * Configure secure session with enhanced Content Security Policy (CSP)
 */
function configureSecureSession() {
  const cspPolicy = [
    "default-src 'self' 'unsafe-inline';",
    "connect-src 'self' ws://localhost:* http://localhost:*;",
    "script-src 'self' 'unsafe-eval';",
    "style-src 'self' 'unsafe-inline';",
    "img-src 'self' data: https:;"
  ].join(" ");

  // Append CSP header to every response to enforce security policies.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = Object.assign({}, details.responseHeaders, {
      "Content-Security-Policy": [cspPolicy]
    });
    callback({ responseHeaders });
  });
}

/**
 * Create the main application window.
 */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  // Determine the URL to load in the main window.
  const indexUrl =
    process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : formatUrl({
          pathname: path.join(__dirname, "index.html"),
          protocol: "file",
          slashes: true,
        });

  mainWindow.loadURL(indexUrl);
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Log successful window load.
  mainWindow.webContents.on("did-finish-load", () => {
    logger.info("Main window loaded successfully.");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/**
 * Setup IPC listeners with input validation.
 */
function setupIpcListeners() {
  // Register IPC handlers using the enhanced handler
  handleIpc('check-installation', async (event, input) => {
    const fs = require('fs');
    const checks = [];
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
      logger.error('Installation check failed:', error);
      return {
        success: false,
        checks: [],
        error: `Installation check failed: ${error.message}`
      };
    }
  });

  handleIpc('get-bridge-status', async () => {
    try {
      const status = await bridgeInit.getStatus();
      return { success: true, ...status };
    } catch (error) {
      logger.error('Failed to get bridge status:', error);
      return { success: false, error: error.message };
    }
  });

  handleIpc('bridge-operation', async (event, { action, data }) => {
    try {
      switch (action) {
        case 'sync-layer':
          return await bridgeInit.syncLayer(data);
        default:
          throw new Error('Invalid bridge operation');
      }
    } catch (error) {
      logger.error('Bridge operation failed:', error);
      return { success: false, error: error.message };
    }
  });
}

// Cleanup function for graceful shutdown
async function cleanupAndExit() {
  logger.info('Starting cleanup process...');
  
  try {
    if (bridgeRunning) {
      logger.info('Stopping bridge processes');
      for (const proc of bridgeProcesses) {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              proc.kill('SIGKILL');
              resolve();
            }, 5000);
            
            proc.once('exit', () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        }
      }
      bridgeProcesses.clear();
      bridgeRunning = false;
    }
  } catch (error) {
    logger.error('Error during cleanup:', error);
  } finally {
    logger.info('Cleanup complete - exiting');
    app.exit();
  }
}

// Register cleanup handlers
app.on('before-quit', () => cleanupAndExit());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndExit();
  }
});

// Initialize security before app is ready
initializeSecurity();

// Initialize security before app is ready
initializeSecurity();

// App Initialization
app.whenReady().then(() => {
  configureSecureSession();
  createMainWindow();
  initializeBridgeAndIpc();
}).catch(err => {
  logger.error('Fatal initialization error:', err);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    cleanupAndExit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});

// Unified cleanup handler with error tracking
app.on('before-quit', async () => {
  const cleanupResult = await cleanupAndExit().catch(error => {
    logger.error('Cleanup process failed:', error);
    return { success: false, error: error.message };
  });
  
  if (!cleanupResult.success) {
    logger.error('Application shutdown encountered errors');
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  })

  // Load content and show window when ready
  mainWindow.loadFile("index.html")
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    configureSecureSession()
  })

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndExit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('before-quit', () => cleanupAndExit())

async function cleanupAndExit() {
  logger.info('Starting cleanup process...')
  
  try {
    if (bridgeRunning) {
      logger.info('Stopping bridge processes')
      for (const proc of bridgeProcesses) {
        if (!proc.killed) {
          proc.kill('SIGTERM')
          await new Promise(resolve => {
            const timeout = setTimeout(() => {
              proc.kill('SIGKILL')
              resolve()
            }, 5000)
            
            proc.once('exit', () => {
              clearTimeout(timeout)
              resolve()
            })
          })
        }
      }
      bridgeProcesses.clear()
      bridgeRunning = false
    }
  } catch (error) {
    logger.error('Error during cleanup:', error)
  } finally {
    logger.info('Cleanup complete - exiting')
    app.exit()
  }
}

// Import bridge initializer
const BridgeInitializer = require('./bridge/bridge-init');
const bridgeInit = new BridgeInitializer();

// IPC handlers with enhanced error handling and validation


// Bridge-related IPC handlers
handleIpc('configure-app', async (event, { app }) => {
  const appName = app.toLowerCase();
  if (appName === 'after effects' || appName === 'ae') {
    return await bridgeInit.initializeAE();
  }
  if (appName === 'resolve') {
    return await bridgeInit.initializeResolve();
  }
  throw new Error('Invalid application specified');
});

handleIpc('get-bridge-status', async () => {
  return bridgeInit.getStatus();
});

handleIpc('bridge-operation', async (event, { action, data }) => {
  switch (action) {
    case 'sync-layer':
      return await bridgeInit.syncLayer(data);
    default:
      throw new Error('Invalid bridge operation');
  }
});
// Initialize application security
function initializeSecurity() {
  app.enableSandbox()
  
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('conectify', process.execPath, [
        path.resolve(process.argv[1])
      ])
    }
  } else {
    app.setAsDefaultProtocolClient('conectify')
  }
}

// Initialize bridge and IPC handlers
function initializeBridgeAndIpc() {
  const BridgeInitializer = require('./bridge/bridge-init');
  const bridgeInit = new BridgeInitializer();

  // Handle IPC methods with validation and error handling
  handleIpc("check-installation", async (event, input) => {
    const fs = require('fs');
    const checks = [];
    const paths = await getPaths();

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
      logger.error('Installation check failed:', error);
      return {
        success: false,
        checks: [],
        error: `Installation check failed: ${error.message}`
      };
    }
  });

  handleIpc("get-paths", getPaths);

  handleIpc("get-bridge-status", async () => {
    try {
      const status = await bridgeInit.getStatus();
      return { success: true, ...status };
    } catch (error) {
      logger.error('Failed to get bridge status:', error);
      return { success: false, error: error.message };
    }
  });

  handleIpc("bridge-operation", async (event, { action, data }) => {
    try {
      switch (action) {
        case 'sync-layer':
          return await bridgeInit.syncLayer(data);
        default:
          throw new Error('Invalid bridge operation');
      }
    } catch (error) {
      logger.error('Bridge operation failed:', error);
      return { success: false, error: error.message };
    }
  });

  handleIpc("configure-app", async (event, { app }) => {
    const appName = app.toLowerCase();
    if (appName === 'after effects' || appName === 'ae') {
      return await bridgeInit.initializeAE();
    }
    if (appName === 'resolve') {
      return await bridgeInit.initializeResolve();
    }
    throw new Error('Invalid application specified');
  });
}

// Get application paths
async function getPaths() {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  
  // Validate platform early
  if (!['win32', 'darwin'].includes(process.platform)) {
    throw new Error('Unsupported platform');
  }
  
  // Default paths based on OS
  let paths = {};
  if (process.platform === 'win32') {
    paths = {
      afterEffects: "C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\AfterFX.exe",
      resolve: "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe"
    };
  } else if (process.platform === 'darwin') {
    paths = {
      afterEffects: "/Applications/Adobe After Effects 2023/Adobe After Effects 2023.app",
      resolve: "/Applications/DaVinci Resolve/DaVinci Resolve.app"
    };
  }

  try {
    // Try to read and decrypt config file
    const configPath = path.join(os.homedir(), '.conectify', 'config.json');
    if (fs.existsSync(configPath)) {
      const { decrypt } = require('./security');
      const encryptedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // Decrypt paths with version validation
      const decryptedPaths = {
        afterEffects: decrypt(encryptedConfig.paths.afterEffects),
        resolve: decrypt(encryptedConfig.paths.resolve)
      };

      // Validate decrypted paths match current OS
      if (process.platform === 'win32' && !decryptedPaths.afterEffects.includes('Program Files')) {
        throw new Error('Invalid Windows path detected');
      }
      if (process.platform === 'darwin' && !decryptedPaths.afterEffects.startsWith('/Applications')) {
        throw new Error('Invalid macOS path detected');
      }

      paths = { ...paths, ...decryptedPaths };
    }
  } catch (error) {
    logger.error('Error reading config:', error);
  }

  return paths;
}

handleIpc("save-paths", async (event, { aePath, resolvePath }) => {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const { encrypt } = require('./security');

  // Validate input paths
  const sanitizedAePath = path.normalize(aePath);
  const sanitizedResolvePath = path.normalize(resolvePath);

  if (!fs.existsSync(sanitizedAePath) || !fs.existsSync(sanitizedResolvePath)) {
    throw new Error('One or more paths do not exist');
  }

  // Ensure config directory exists
  const configDir = path.join(os.homedir(), '.conectify');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Create encrypted config
  const config = {
    paths: {
      afterEffects: encrypt(sanitizedAePath),
      resolve: encrypt(sanitizedResolvePath)
    },
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2),
    { mode: 0o600 }
  );

  return { success: true };
});

// Bridge process management
const HEALTH_CHECK_INTERVAL = 30000 // 30 seconds

function manageBridgeProcess(process) {
  bridgeProcesses.add(process)
  let restartAttempts = 0
  const MAX_RESTART_ATTEMPTS = 5
  const RESTART_DELAY = 5000
  let healthCheckTimer = null
  
  // Setup health check
  healthCheckTimer = setInterval(() => {
    if (!process.connected) {
      logger.warn('Bridge process health check failed - process disconnected')
      process.emit('error', new Error('Health check failed'))
    }
  }, HEALTH_CHECK_INTERVAL)
  
  process.on('exit', (code, signal) => {
    clearInterval(healthCheckTimer)
    bridgeProcesses.delete(process)
    logger.warn(`Bridge process exited with code ${code} (${signal})`)
    
    if (bridgeRunning && restartAttempts < MAX_RESTART_ATTEMPTS) {
      restartAttempts++
      logger.info(`Attempting bridge process restart (${restartAttempts}/${MAX_RESTART_ATTEMPTS})...`)
      
      setTimeout(() => {
        startBridgeProcess().catch(err => {
          logger.error(`Bridge restart failed: ${err.message}`)
          if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
            logger.error('Max restart attempts reached. Bridge service will not restart automatically.')
            bridgeRunning = false
            // Notify renderer process of bridge failure
            if (mainWindow) {
              mainWindow.webContents.send('bridge-status-change', { running: false, error: 'Bridge service failed to restart' })
            }
          }
        })
      }, RESTART_DELAY)
    } else if (bridgeRunning) {
      logger.error('Max restart attempts reached. Bridge service will not restart automatically.')
      bridgeRunning = false
      // Notify renderer process
      if (mainWindow) {
        mainWindow.webContents.send('bridge-status-change', { running: false, error: 'Bridge service stopped' })
      }
    }
  })
  
  process.on('error', (err) => {
    logger.error(`Bridge process error: ${err.message}`)
    bridgeProcesses.delete(process)
    clearInterval(healthCheckTimer)
  })

  // Handle process cleanup
  process.on('SIGTERM', () => {
    clearInterval(healthCheckTimer)
    process.exit(0)
  })
}

async function startBridgeProcess() {
  if (bridgeRunning) {
    throw new Error('Bridge is already running')
  }

  const { spawn } = require('child_process')
  const bridgeProcess = spawn('node', ['bridge/index.js'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      CONECTIFY_BRIDGE: 'true'
    }
  })

  bridgeRunning = true
  manageBridgeProcess(bridgeProcess)

  // Log bridge output
  bridgeProcess.stdout.on('data', data => 
    logger.info(`[Bridge] ${data.toString().trim()}`))
  bridgeProcess.stderr.on('data', data => 
    logger.error(`[Bridge] ${data.toString().trim()}`))

  return new Promise((resolve, reject) => {
    bridgeProcess.once('error', reject)
    
    // Wait for startup confirmation
    const startupTimer = setTimeout(() => {
      bridgeProcess.removeListener('error', reject)
      reject(new Error('Bridge startup timed out'))
    }, 5000)

    bridgeProcess.stdout.on('data', (data) => {
      if (data.toString().includes('Bridge listening on')) {
        clearTimeout(startupTimer)
        resolve()
      }
    })
  })
}

// Consolidated bridge operation handler
handleIpc('bridge-operation', async (event, { action, data }) => {
  switch (action) {
    case 'start':
      await startBridgeProcess()
      return { success: true, message: 'Bridge started successfully' }
    
    case 'stop':
      if (!bridgeRunning) {
        throw new Error('Bridge is not running')
      }
      
      bridgeRunning = false
      for (const proc of bridgeProcesses) {
        proc.kill('SIGTERM')
      }
      return { success: true, message: 'Bridge stopped successfully' }
    
    case 'sync-layer':
      return await bridgeInit.syncLayer(data)
    
    default:
      throw new Error('Invalid bridge operation')
  }
})

// Initialize application
async function initializeApp() {
  initializeSecurity()
  
  app.on('web-contents-created', (event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      event.preventDefault()
      logger.warn('Blocked webview attachment attempt')
    })
  })

  createWindow()
}

// Initialize security before app is ready
initializeSecurity()

app.whenReady().then(() => {
  configureSecureSession()
  createWindow()
}).catch(err => {
  logger.error('Fatal initialization error:', err)
  app.quit()
})

// Handle process cleanup
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    cleanupAndExit()
  }
})

app.on('before-quit', () => cleanupAndExit())

async function cleanupAndExit() {
  logger.info('Starting cleanup process...')
  
  if (bridgeRunning) {
    logger.info('Stopping bridge processes')
    for (const proc of bridgeProcesses) {
      proc.kill('SIGTERM')
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  logger.info('Cleanup complete - exiting')
  app.exit()
}

handleIpc("configure-app", async (event, { app }) => {
  const fs = require('fs');
  const path = require('path');
  const { spawn } = require('child_process');

  // Get application paths
  const paths = await ipcMain.handle('get-paths');
  
  if (app === 'After Effects') {
    const scriptPath = path.join(__dirname, 'bridge', 'scripts', 'ae-script.jsx');
    if (!fs.existsSync(scriptPath)) {
      throw new Error('After Effects script not found');
    }
    
    // Run the configuration script
    const process = spawn(paths.afterEffects, ['-r', scriptPath]);
    await new Promise((resolve, reject) => {
      process.on('exit', code => {
        if (code === 0) resolve();
        else reject(new Error(`After Effects configuration failed with code ${code}`));
      });
      process.on('error', reject);
    });
    
  } else if (app === 'DaVinci Resolve') {
    const scriptPath = path.join(__dirname, 'bridge', 'scripts', 'resolve-bridge.lua');
    if (!fs.existsSync(scriptPath)) {
      throw new Error('DaVinci Resolve script not found');
    }
    
    // Copy script to Resolve's script directory
    const resolveScriptsDir = path.join(process.env.HOME, 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve', 'Fusion', 'Scripts');
    fs.copyFileSync(scriptPath, path.join(resolveScriptsDir, 'resolve-bridge.lua'));
  } else {
    throw new Error('Invalid application specified');
  }

  return { success: true, message: `${app} configured successfully` }
})

handleIpc("get-bridge-status", async () => {
  return { 
    success: true,
    running: bridgeRunning,
    processes: bridgeProcesses.size
  }
})
