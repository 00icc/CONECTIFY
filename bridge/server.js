const express = require('express');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const path = require('path');

class BridgeServer {
    constructor() {
        this.app = express();
        this.port = 3000;
        this.wsServer = null;
        this.clients = new Map();
        this.aeProcess = null;
        this.resolveProcess = null;
        this.setupExpress();
    }

    setupExpress() {
        this.app.use(express.json());
        
        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'healthy' });
        });

        // Status endpoint
        this.app.get('/status', (req, res) => {
            res.json({
                aeConnected: this.clients.has('ae'),
                resolveConnected: this.clients.has('resolve'),
                bridgeStatus: this.wsServer ? 'running' : 'stopped'
            });
        });
    }

    start() {
        return new Promise((resolve, reject) => {
            try {
                const server = this.app.listen(this.port, () => {
                    console.log(`Bridge server listening on port ${this.port}`);
                    this.setupWebSocket(server);
                    resolve();
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    setupWebSocket(server) {
        this.wsServer = new WebSocket.Server({ server });

        this.wsServer.on('connection', (ws) => {
            ws.on('message', (message) => this.handleMessage(ws, message));
            ws.on('close', () => this.handleDisconnect(ws));
        });
    }

    handleMessage(ws, message) {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'register':
                    this.registerClient(ws, data.client);
                    break;
                case 'ae_data':
                    this.broadcastToResolve(data);
                    break;
                case 'resolve_data':
                    this.broadcastToAE(data);
                    break;
                default:
                    console.warn('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    registerClient(ws, clientType) {
        this.clients.set(clientType, ws);
        console.log(`${clientType} client registered`);
    }

    handleDisconnect(ws) {
        for (const [clientType, client] of this.clients.entries()) {
            if (client === ws) {
                this.clients.delete(clientType);
                console.log(`${clientType} client disconnected`);
                break;
            }
        }
    }

    broadcastToResolve(data) {
        const resolveClient = this.clients.get('resolve');
        if (resolveClient) {
            resolveClient.send(JSON.stringify(data));
        }
    }

    broadcastToAE(data) {
        const aeClient = this.clients.get('ae');
        if (aeClient) {
            aeClient.send(JSON.stringify(data));
        }
    }

    stop() {
        return new Promise((resolve) => {
            if (this.wsServer) {
                this.wsServer.close(() => {
                    console.log('Bridge server stopped');
                    this.wsServer = null;
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = BridgeServer;