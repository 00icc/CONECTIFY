// CONECTIFY Bridge Client for After Effects
const WebSocket = require('ws');

class AEBridgeClient {
    constructor(port = 3000) {
        this.port = port;
        this.ws = null;
        this.connected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(`ws://localhost:${this.port}`);

                this.ws.on('open', () => {
                    this.connected = true;
                    this.reconnectAttempts = 0;
                    this.register();
                    resolve();
                });

                this.ws.on('message', (data) => {
                    this.handleMessage(JSON.parse(data));
                });

                this.ws.on('close', () => {
                    this.connected = false;
                    this.handleDisconnect();
                });

                this.ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    if (!this.connected) {
                        reject(error);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    register() {
        this.send({
            type: 'register',
            client: 'ae'
        });
    }

    send(data) {
        if (this.connected && this.ws) {
            this.ws.send(JSON.stringify(data));
        }
    }

    handleMessage(data) {
        try {
            if (data.type === 'resolve_data') {
                // Process incoming data from Resolve
                this.processResolveData(data);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    }

    processResolveData(data) {
        // Implement data processing logic here
        // This will be called when receiving data from Resolve
        console.log('Received data from Resolve:', data);
    }

    handleDisconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => {
                this.connect().catch(console.error);
            }, 1000 * this.reconnectAttempts);
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
            this.connected = false;
        }
    }

    sendCompositionData(compData) {
        this.send({
            type: 'ae_data',
            data: compData
        });
    }
}

module.exports = AEBridgeClient;