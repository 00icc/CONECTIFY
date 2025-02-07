/*
 * WEXON FX - CONECTIFY After Effects Bridge Server
 * Copyright (c) 2024 WEXON FX. All rights reserved.
 * 
 * This source code is protected and is part of WEXON FX's proprietary software.
 * Any unauthorized copying, modification, distribution, or use is strictly prohibited.
 * 
 * Script Verification Hash: WFX-AEB-${new Date().getFullYear()}-CONECTIFY
 */

const { WebSocketServer } = require('ws');
const express = require('express');
const { exec } = require('child_process');
const http = require('http');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
}));

// Connection tracking
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000;

// Parse command line arguments
const HTTP_PORT = parseInt(process.argv[2]) || 3001;
const WS_PORT = parseInt(process.argv[3]) || 3002;

// Track active connections and processes
let activeConnections = new Set();
let activeProcesses = new Set();

// WebSocket Server with protocol negotiation
const wss = new WebSocketServer({
  server,
  path: '/ws',
  handleProtocols: (protocols) => {
    // Require RFC 6455 (v13) which is the standard protocol
    return protocols.includes('v13') ? 'v13' : false;
  }
});

wss.on('connection', (ws) => {
  console.log('AE Client connected');
  reconnectAttempts = 0; // Reset reconnection attempts on successful connection
  
  // Keep-alive mechanism
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      ws.ping();
    }
  }, 30000);
  
  ws.on('message', (message) => {
    try {
      const { type, compName } = JSON.parse(message);
      
      switch(type) {
        case 'get-layers':
          const process = exec(`osascript -e 'tell application "Adobe After Effects 2023" to do script "#include ${__dirname}/../../bridge/scripts/ae-script.jsx"'`,
            (error, stdout, stderr) => {
              if (error) {
                ws.send(JSON.stringify({ error: `AE Script Error: ${stderr}` }));
                return;
              }
              ws.send(stdout);
            });
          activeProcesses.add(process);
          process.on('exit', () => {
            activeProcesses.delete(process);
          });
          break;

        case 'render-composition':
          const renderProcess = exec(`osascript -e 'tell application "Adobe After Effects 2023" to do script "#include ${__dirname}/../../bridge/scripts/render-script.jsx"'`,
            (error, stdout, stderr) => {
              if (error) {
                ws.send(JSON.stringify({ error: `Render Error: ${stderr}` }));
                return;
              }
              ws.send(JSON.stringify({ status: 'rendering', progress: stdout }));
            });
          activeProcesses.add(renderProcess);
          renderProcess.on('exit', (code) => {
            activeProcesses.delete(renderProcess);
            if (code !== 0) {
              ws.send(JSON.stringify({ error: `Render process exited with code ${code}` }));
            } else {
              ws.send(JSON.stringify({ status: 'completed' }));
            }
          });
          renderProcess.on('error', (err) => {
            activeProcesses.delete(renderProcess);
            ws.send(JSON.stringify({ error: `Render process error: ${err.message}` }));
          });
          break;

        case 'cancel-render':
          exec(`osascript -e 'tell application "Adobe After Effects 2023" to do script "#include ${__dirname}/../../bridge/scripts/cancel-render.jsx"'`,
            (error) => {
              ws.send(JSON.stringify({ status: 'cancelled' }));
            });
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;
          
        default:
          ws.send(JSON.stringify({ error: 'Unknown command type' }));
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  });

  activeConnections.add(ws);

  ws.on('close', () => {
    console.log('AE Client disconnected');
    clearInterval(pingInterval);
    activeConnections.delete(ws);
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setTimeout(() => {
        reconnectAttempts++;
        console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        const ws = new WebSocket(`ws://localhost:${WS_PORT}/ws`);
        ws.on('open', () => {
          console.log('Reconnected successfully');
          reconnectAttempts = 0;
        });
        ws.on('error', () => {
          console.log('Reconnection failed');
        });
      }, RECONNECT_DELAY);
    } else {
      console.log('Max reconnection attempts reached');
    }
  });
});

// HTTP Status Endpoint
app.get('/status', (req, res) => {
  const status = {
    connected: wss.clients.size > 0,
    clients: wss.clients.size
  };
  console.log('Status:', status);
  res.json(status);
});

// Start combined server
server.listen(HTTP_PORT, () => {
  console.log(`AE Bridge Server running on port ${HTTP_PORT} (WS: ${WS_PORT})`);
  serverRunning = true;
}).on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${HTTP_PORT} is already in use. Attempting to find available port...`);
    server.listen(0, () => {
      const newPort = server.address().port;
      console.log(`AE Bridge Server running on alternative port ${newPort}`);
      serverRunning = true;
    });
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

// Handle server errors
app.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${HTTP_PORT} is already in use. Retrying in 5 seconds...`);
    handleServerRestart();
  } else {
    console.error('Server error:', error);
  }
});

// Handle WebSocket server errors
wss.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${WS_PORT} is already in use. Retrying in 5 seconds...`);
    handleServerRestart();
  } else {
    console.error('WebSocket server error:', error);
    wss.close(() => {
      console.log('WebSocket server closed.');
    });
  }
});

// Graceful shutdown
function cleanup() {
  console.log('Cleaning up resources...');
  
  // Clean up active connections
  for (const connection of activeConnections) {
    try {
      connection.close();
    } catch (err) {
      console.error('Error closing connection:', err);
    }
  }
  
  // Clean up active processes
  for (const process of activeProcesses) {
    try {
      process.kill();
    } catch (err) {
      console.error('Error killing process:', err);
    }
  }
}

process.on('SIGINT', () => {
  console.log('Shutting down AE Bridge Server...');
  cleanup();
  wss.close(() => {
    console.log('WebSocket server closed.');
    app.close(() => {
      console.log('Express server closed.');
      process.exit(0);
    });
  });
});

process.on('SIGTERM', () => {
  console.log('Shutting down AE Bridge Server...');
  cleanup();
  wss.close(() => {
    console.log('WebSocket server closed.');
    app.close(() => {
      console.log('Express server closed.');
      process.exit(0);
    });
  });
});

// Ensure the server does not attempt to restart if it is already running
let serverRunning = false;

app.on('listening', () => {
  serverRunning = true;
});

app.on('close', () => {
  serverRunning = false;
});

wss.on('listening', () => {
  serverRunning = true;
});

wss.on('close', () => {
  serverRunning = false;
});

// Prevent multiple restarts
let restartTimeout = null;

function handleServerRestart() {
  if (serverRunning) return;
  if (restartTimeout) clearTimeout(restartTimeout);

  restartTimeout = setTimeout(() => {
  console.log(`Attempting to restart AE Bridge Server on port ${HTTP_PORT}...`);
  app.listen(HTTP_PORT, () => {
    console.log(`AE Bridge Server running on port ${HTTP_PORT}`);
    });
  }, 5000);
}
