import { invoke } from '@tauri-apps/api/tauri';

// Bridge error types to match Rust backend
class BridgeError extends Error {
    constructor(type, message) {
        super(message);
        this.type = type;
        this.name = 'BridgeError';
    }
}

class BridgeService {
    constructor() {
        this.isInitialized = false;
        this.configureApp = {};
        this.initializeBridge();
    }

    async initializeBridge() {
        try {
            const config = await invoke('load_config');
            this.configureApp = {
                status: 'initialized',
                version: '1.0.0',
                settings: config
            };
            this.isInitialized = true;
            this.bridgeStatus = 'stopped';
        } catch (error) {
            console.error('Failed to initialize bridge:', error);
            throw new BridgeError('Init', 'Failed to initialize bridge');
        }
    }

    async startBridge() {
        if (!this.isInitialized) {
            throw new BridgeError('State', 'Bridge not initialized');
        }

        try {
            await invoke('start_bridge');
            this.bridgeStatus = 'running';
            return { success: true };
        } catch (error) {
            console.error('Failed to start bridge:', error);
            throw new BridgeError('Process', `Failed to start bridge: ${error.message}`);
        }
    }

    async stopBridge() {
        if (!this.isInitialized) {
            throw new BridgeError('State', 'Bridge not initialized');
        }

        try {
            await invoke('stop_bridge');
            this.bridgeStatus = 'stopped';
            return { success: true };
        } catch (error) {
            console.error('Failed to stop bridge:', error);
            throw new BridgeError('Process', `Failed to stop bridge: ${error.message}`);
        }
    }

    async getBridgeStatus() {
        try {
            return await invoke('get_bridge_status');
        } catch (error) {
            console.error('Failed to get bridge status:', error);
            throw new BridgeError('State', `Failed to get bridge status: ${error.message}`);
        }
    }

    async getConfig() {
        try {
            return await invoke('load_config');
        } catch (error) {
            console.error('Failed to get config:', error);
            throw new BridgeError('Config', `Failed to get config: ${error.message}`);
        }
    }
}

const bridgeService = new BridgeService();
export default bridgeService;