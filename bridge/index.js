const { execFile } = require('child_process');
const path = require('path');
const fetch = require('node-fetch');

class AEBridge {
  constructor() {
    this.scriptPath = path.join(__dirname, 'scripts', 'ae-script.jsx');
    this.isConnected = false;
    this.lastSyncTime = null;
  }

  async connect() {
    try {
      await this.getLayers();
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('Failed to connect to After Effects:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async getLayers() {
    return new Promise((resolve, reject) => {
      const { WebSocket } = require('ws');
      const ws = new WebSocket('ws://localhost:3001/ae-bridge');

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'get-layers',
          compName: 'current'
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            throw new Error(data.error);
          }
          this.lastSyncTime = Date.now();
          resolve(data.layers);
        } catch (error) {
          console.error('WebSocket message handling failed:', error);
          this.isConnected = false;
          reject(error);
        } finally {
          ws.close();
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket connection error:', error);
        this.isConnected = false;
        reject(error);
      };
    });
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      lastSync: this.lastSyncTime
    };
  }
}

class ResolveBridge {
  constructor() {
    this.resolvePort = 3000;
    this.isConnected = false;
    this.lastSyncTime = null;
    this.retryAttempts = 3;
    this.retryDelay = 1000;
  }

  async connect() {
    try {
      await this.testConnection();
      this.isConnected = true;
      return true;
    } catch (error) {
      console.error('Failed to connect to DaVinci Resolve:', error);
      this.isConnected = false;
      throw error;
    }
  }

  async testConnection() {
    try {
      const response = await fetch(`http://localhost:${this.resolvePort}/resolve/api/v1/fusion/status`);
      if (!response.ok) throw new Error('Resolve API not responding');
      return true;
    } catch (error) {
      throw new Error('Unable to connect to DaVinci Resolve');
    }
  }

  async createNode(layerData, attempt = 1) {
    if (!this.isConnected) {
      throw new Error('Not connected to DaVinci Resolve');
    }

    try {
      const nodeData = this.convertLayerToNode(layerData);
      const response = await fetch(`http://localhost:${this.resolvePort}/resolve/api/v1/fusion/comp/node`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nodeData)
      });

      if (!response.ok) {
        throw new Error(`Failed to create node: ${response.statusText}`);
      }

      this.lastSyncTime = Date.now();
      return await response.json();
    } catch (error) {
      if (attempt < this.retryAttempts) {
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
        return this.createNode(layerData, attempt + 1);
      }
      this.isConnected = false;
      throw error;
    }
  }

  convertLayerToNode(layerData) {
    return {
      nodeType: this.getNodeTypeFromLayer(layerData.type),
      name: layerData.name,
      properties: this.convertProperties(layerData.properties)
    };
  }

  getNodeTypeFromLayer(aeLayerType) {
    const typeMap = {
      'solid': 'Background',
      'composition': 'Merge',
      'text': 'Text+',
      'shape': 'Rectangle',
      'image': 'Loader',
      'video': 'MediaIn'
    };

    return typeMap[aeLayerType] || 'MediaIn';
  }

  convertProperties(aeProperties) {
    const resolveProperties = {};

    for (const [key, value] of Object.entries(aeProperties)) {
      switch (typeof value) {
        case 'number':
          resolveProperties[key] = {
            type: 'Number',
            value: value
          };
          break;
        case 'boolean':
          resolveProperties[key] = {
            type: 'Boolean',
            value: value
          };
          break;
        case 'string':
          resolveProperties[key] = {
            type: 'Text',
            value: value
          };
          break;
        case 'object':
          if (Array.isArray(value) && value.length === 2) {
            resolveProperties[key] = {
              type: 'Point',
              value: { X: value[0], Y: value[1] }
            };
          }
          break;
      }
    }

    return resolveProperties;
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      lastSync: this.lastSyncTime
    };
  }
}

module.exports = { AEBridge, ResolveBridge };