const { AEBridge, ResolveBridge } = require('./index');
const logger = require('../logger');

class BridgeInitializer {
    constructor() {
        this.aeBridge = new AEBridge();
        this.resolveBridge = new ResolveBridge();
        this.status = {
            ae: { connected: false, configured: false, health: 'unknown' },
            resolve: { connected: false, configured: false, health: 'unknown' }
        };
        this.maxRetries = 3;
        this.retryDelay = 2000;
        this.connectionTimeout = 10000;
        this.healthCheckInterval = 30000;
        this.initializeHealthChecks();
    }

    initializeHealthChecks() {
        setInterval(() => {
            if (this.status.ae.connected) {
                this.checkBridgeHealth('ae');
            }
            if (this.status.resolve.connected) {
                this.checkBridgeHealth('resolve');
            }
        }, this.healthCheckInterval);
    }

    async checkBridgeHealth(bridgeType) {
        try {
            const bridge = bridgeType === 'ae' ? this.aeBridge : this.resolveBridge;
            const isHealthy = await this.retryOperation(
                async () => await bridge.ping(),
                `${bridgeType.toUpperCase()} Health Check`
            );
            this.status[bridgeType].health = isHealthy ? 'healthy' : 'unhealthy';
            if (!isHealthy) {
                logger.warn(`${bridgeType.toUpperCase()} bridge health check failed`);
                await this.reconnectBridge(bridgeType);
            }
        } catch (error) {
            this.status[bridgeType].health = 'error';
            logger.error(`Health check failed for ${bridgeType.toUpperCase()} bridge:`, error);
        }
    }

    async reconnectBridge(bridgeType) {
        logger.info(`Attempting to reconnect ${bridgeType.toUpperCase()} bridge`);
        try {
            await (bridgeType === 'ae' ? this.initializeAE() : this.initializeResolve());
            logger.info(`Successfully reconnected ${bridgeType.toUpperCase()} bridge`);
        } catch (error) {
            logger.error(`Failed to reconnect ${bridgeType.toUpperCase()} bridge:`, error);
        }
    }

    async retryOperation(operation, name) {
        let lastError;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error(`Connection timeout for ${name}`)), this.connectionTimeout);
                });
                const operationPromise = operation();
                return await Promise.race([operationPromise, timeoutPromise]);
            } catch (error) {
                lastError = error;
                logger.warn(`Attempt ${attempt}/${this.maxRetries} failed for ${name}: ${error.message}`);
                if (attempt < this.maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                }
            }
        }
        throw lastError;
    }

    async initializeAE() {
        try {
            if (this.status.ae.connected) {
                await this.aeBridge.cleanup();
            }

            await this.retryOperation(
                async () => await this.aeBridge.connect(),
                'After Effects'
            );

            const version = await this.aeBridge.getVersion();
            this.status.ae = {
                connected: true,
                configured: true,
                health: 'healthy',
                lastSync: Date.now(),
                version
            };

            logger.info('After Effects bridge initialized successfully');
            return { success: true, message: 'After Effects configured successfully' };
        } catch (error) {
            this.status.ae = {
                ...this.status.ae,
                connected: false,
                health: 'error',
                error: error.message
            };
            logger.error('Failed to initialize After Effects bridge:', error);
            return { success: false, message: error.message };
        }
    }

    async initializeResolve() {
        try {
            if (this.status.resolve.connected) {
                await this.resolveBridge.cleanup();
            }

            await this.retryOperation(
                async () => await this.resolveBridge.connect(),
                'DaVinci Resolve'
            );

            const version = await this.resolveBridge.getVersion();
            this.status.resolve = {
                connected: true,
                configured: true,
                health: 'healthy',
                lastSync: Date.now(),
                version
            };

            logger.info('DaVinci Resolve bridge initialized successfully');
            return { success: true, message: 'DaVinci Resolve configured successfully' };
        } catch (error) {
            this.status.resolve = {
                ...this.status.resolve,
                connected: false,
                health: 'error',
                error: error.message
            };
            logger.error('Failed to initialize DaVinci Resolve bridge:', error);
            return { success: false, message: error.message };
        }
    }

    getStatus() {
        return {
            ...this.status,
            lastUpdate: Date.now(),
            bridgeVersion: require('../package.json').version
        };
    }

    async syncLayer(layerData) {
        try {
            if (!this.status.ae.connected || !this.status.resolve.connected) {
                throw new Error('Both bridges must be connected to sync layers');
            }
            if (this.status.ae.health !== 'healthy' || this.status.resolve.health !== 'healthy') {
                throw new Error('Both bridges must be healthy to sync layers');
            }
            const layers = await this.retryOperation(
                async () => await this.aeBridge.getLayers(),
                'Get AE Layers'
            );
            const targetLayer = layers.find(layer => layer.name === layerData.name);
            if (!targetLayer) {
                throw new Error(`Layer ${layerData.name} not found in After Effects`);
            }
            await this.retryOperation(
                async () => await this.resolveBridge.createNode(targetLayer),
                'Create Resolve Node'
            );
            return { success: true, message: 'Layer synced successfully' };
        } catch (error) {
            logger.error('Failed to sync layer:', error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = BridgeInitializer;